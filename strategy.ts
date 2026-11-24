// Early-rise sniper with staged exits.
//
// Idea: on pump.fun most new coins flatline, but the ones that run show it
// almost immediately — a cluster of early buys lifts the price off its
// creation level within minutes. This bot only buys coins that prove that
// early traction (price up a little, several buys already in), then exits
// fast: take profit on a strong run, stop loss on a fade, a trailing stop
// off the peak, and a hard time exit so no position is left to bleed out.
//
// Everything is deterministic: every decision comes from the replay state
// (slots, reserves, fills) and this bot's own maps, which iterate in
// first-seen order. No clock, no environment, no randomness.

import { LAMPORTS_PER_SOL } from './vendor/makefun-bot.ts';
import type { Batch, Bot, BotState, OrderInput } from './vendor/makefun-bot.ts';

export interface Params {
  /** SOL to spend per buy (before the per-mint size cap trims it). */
  stakeLamports: bigint;
  /** Smallest buy worth sending: a round trip below this cannot meet the guardrail. */
  minBuyLamports: bigint;
  /** Buy once the price is up this many bps over the first-seen price. */
  entryRiseBps: number;
  /** Do not chase a coin already up more than this many bps over first sight. */
  maxEntryRiseBps: number;
  /** Buys that must already have landed on the coin before we enter. */
  minEarlyBuys: number;
  /** Stop considering a coin this many slots after its first sight. */
  freshSlots: number;
  /** Sell when the position is worth cost + this many bps. */
  takeProfitBps: number;
  /** Sell when the position is worth cost - this many bps. */
  stopLossBps: number;
  /** Sell when the position has fallen this many bps from its peak value. */
  trailDropBps: number;
  /** Sell whatever is left this many slots after the buy filled. */
  maxHoldSlots: number;
  /** Slippage allowance on every order. */
  slippageBps: number;
  /**
   * Confirmation: after the rise first triggers, wait this many slots and
   * only buy if the price is still up at least confirmRiseBps and at least
   * confirmBuys more buys have landed since the trigger. A flash spike that
   * dumps immediately never confirms; a coin with sustained buying does.
   * 0 disables confirmation (buy on the trigger itself).
   */
  confirmSlots: number;
  confirmRiseBps: number;
  confirmBuys: number;
}

export const DEFAULT_PARAMS: Params = {
  stakeLamports: LAMPORTS_PER_SOL / 5n,
  minBuyLamports: LAMPORTS_PER_SOL / 100n,
  entryRiseBps: 1000,
  maxEntryRiseBps: 15000,
  minEarlyBuys: 4,
  freshSlots: 1500,
  takeProfitBps: 12000,
  stopLossBps: 2000,
  trailDropBps: 1200,
  maxHoldSlots: 900,
  slippageBps: 500,
  confirmSlots: 180,
  confirmRiseBps: 600,
  confirmBuys: 1,
};

const BPS = 10_000n;

interface CoinTrack {
  /** Price reference at first sight (virtual reserves then). */
  refVq: bigint;
  refVt: bigint;
  createdSlot: number;
  buys: number;
  /** Bought, skipped for good, or completed: never decide on it again. */
  decided: boolean;
  /** Slot the entry rise first triggered, or null when it never has. */
  triggerSlot: number | null;
  /** Buys counted when the rise first triggered. */
  triggerBuys: number;
}

interface PosTrack {
  buySlot: number;
  peakValue: bigint;
}

/** Mark-to-market value of `tokens` on `curve` reserves, in lamports. */
function markValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (vt <= 0n || tokens <= 0n) return 0n;
  return (tokens * vq) / vt;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<string, CoinTrack>();
  const held = new Map<string, PosTrack>();

  function observe(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!coins.has(e.mint)) {
          coins.set(e.mint, {
            refVq: BigInt(e.virtual_sol_reserves),
            refVt: BigInt(e.virtual_token_reserves),
            createdSlot: e.slot,
            buys: 0,
            decided: false,
            triggerSlot: null,
            triggerBuys: 0,
          });
        }
      } else if (e.event === 'TradeEvent') {
        const track = coins.get(e.mint);
        if (track === undefined) {
          coins.set(e.mint, {
            refVq: BigInt(e.virtual_sol_reserves),
            refVt: BigInt(e.virtual_token_reserves),
            createdSlot: e.slot,
            buys: e.is_buy ? 1 : 0,
            decided: false,
            triggerSlot: null,
            triggerBuys: 0,
          });
        } else if (e.is_buy) {
          track.buys += 1;
        }
      } else {
        const track = coins.get(e.mint);
        if (track !== undefined) track.decided = true;
      }
    }
  }

  function exits(state: BotState): OrderInput[] {
    const orders: OrderInput[] = [];
    for (const [mint, holding] of state.positions) {
      if ([...state.pending.values()].some((p) => p.order.side === 'sell' && p.order.mint === mint)) {
        continue;
      }
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete || curve.virtual_token_reserves <= 0n) continue;
      const value = markValue(holding.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves);
      const track = held.get(mint) ?? { buySlot: state.slot, peakValue: value };
      if (value > track.peakValue) track.peakValue = value;
      held.set(mint, track);
      const cost = holding.cost_lamports;
      const takeProfit = value * BPS >= cost * (BPS + BigInt(params.takeProfitBps));
      const stopLoss = value * BPS <= cost * (BPS - BigInt(params.stopLossBps));
      const trailing = value * BPS <= track.peakValue * (BPS - BigInt(params.trailDropBps));
      const timedOut = state.slot - track.buySlot >= params.maxHoldSlots;
      if (takeProfit || stopLoss || trailing || timedOut) {
        orders.push({ side: 'sell', mint, token_amount: holding.token_amount, max_slippage_bps: params.slippageBps });
        held.delete(mint);
      }
    }
    return orders;
  }

  function entries(state: BotState, orders: OrderInput[]): OrderInput[] {
    const { caps } = state.hello;
    const tx = state.txFeeLamports();
    let free = state.freeCashLamports();
    let slots = caps.max_open_positions - state.committedPositionCount();
    for (const [mint, track] of coins) {
      if (orders.length >= caps.max_orders_per_batch || slots <= 0) break;
      if (track.decided) continue;
      if (state.slot - track.createdSlot > params.freshSlots) {
        track.decided = true;
        continue;
      }
      if (track.buys < params.minEarlyBuys) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) {
        track.decided = true;
        continue;
      }
      if (track.refVq <= 0n || track.refVt <= 0n) {
        track.decided = true;
        continue;
      }
      // priceNow / priceRef = (vq * refVt) / (vt * refVq); compare in bps without floats.
      const num = curve.virtual_quote_reserves * track.refVt;
      const den = curve.virtual_token_reserves * track.refVq;
      if (den <= 0n) {
        track.decided = true;
        continue;
      }
      if (num * BPS < den * (BPS + BigInt(params.entryRiseBps))) continue;
      if (num * BPS > den * (BPS + BigInt(params.maxEntryRiseBps))) {
        track.decided = true;
        continue;
      }
      // Rise triggered: with confirmation on, wait and demand the move holds.
      if (params.confirmSlots > 0 && track.triggerSlot === null) {
        track.triggerSlot = state.slot;
        track.triggerBuys = track.buys;
        continue;
      }
      if (params.confirmSlots > 0 && track.triggerSlot !== null) {
        if (state.slot - track.triggerSlot < params.confirmSlots) continue;
        if (num * BPS < den * (BPS + BigInt(params.confirmRiseBps))) {
          track.decided = true;
          continue;
        }
        if (track.buys < track.triggerBuys + params.confirmBuys) continue;
      }
      const cap = state.maxBuyLamports(mint);
      if (cap < params.minBuyLamports) continue;
      const amount = cap < params.stakeLamports ? cap : params.stakeLamports;
      if (free < amount + tx) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: params.slippageBps });
      track.decided = true;
      free -= amount + tx;
      slots -= 1;
    }
    return orders;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      observe(batch);
      const orders = exits(state);
      return entries(state, orders);
    },
  };
}
