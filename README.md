# u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/mouns4117-ai/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/mouns4117-ai/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Early-rise sniper bot for make.fun's Pump.fun Paper Sprint: Any Bot Can Win bounty, $2 in USDC. The bot paper-trades pump.fun on a 6-hour replay — no real money, no real trades, replay data only.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` with this directory mounted at `/bot`. Node 22 runs the TypeScript as-is; nothing to install (zero dependencies).

## Strategy

Most new pump.fun coins flatline, but the ones that run show it almost immediately: a cluster of early buys lifts the price off its creation level within minutes. This bot only buys coins that prove that early traction, then exits fast.

- **Entry:** a coin counts once its price is up 10% over first sight with at least 4 buys already in. The rise must then *confirm*: 180 slots later the price is still up at least 6% and at least one more buy has landed. A flash spike that dumps immediately never confirms; a coin with sustained buying does. Coins already up more than 150% are never chased, and a coin is only considered for 1500 slots after first sight.
- **Size:** 0.2 SOL per buy (trimmed by the per-mint size cap, never below 0.01 SOL), at most 5 open positions, at most 16 orders per batch.
- **Exits:** take profit at +120% of cost, stop loss at −20%, a trailing stop 12% below the peak value, and a hard time exit 900 slots after the buy filled. Positions are always sold in full.
- **Determinism:** every decision comes from the replay state (slots, reserves, fills) and first-seen-order maps. No clock, no environment, no randomness — the two grading executions produce byte-identical action logs.

## Local backtest

On the kit's dev window (24 h, 1,222 mints) the bot scores −0.099 SOL net PnL across 101 round trips (18 wins), max drawdown 2.9% — near breakeven on a window where the kit's own momentum pilot loses −9.38 SOL, and comfortably inside the guardrails (≥20 round trips of ≥0.01 SOL, drawdown ≤50%). At 2× fees it scores −0.196 SOL, so the result does not hinge on cheap fees. The final 6-hour window is fresh data, so the dev number is a sanity check, not a forecast.

## Why this shape wins

The equal-weight baseline buys every coin and holds; on the dev window it barely trades at all (5 fills — the 5-position cap never frees up) and scores ≈0. Active strategies that buy the first spike lose the spread on every round trip. The confirmation step is the whole edge: waiting 180 slots and demanding the move hold filters out the instant dumps, cutting trips from 184 to 101 and losses from −1.29 SOL to −0.10 SOL on the same window, while keeping enough round trips to clear the 20-coin guardrail on a 6-hour final.

## Layout

- `main.ts` — entrypoint: hands the strategy to the replay shim.
- `strategy.ts` — the strategy (entry, confirmation, exits, sizing).
- `vendor/makefun-bot.ts` — the kit's replay shim, vendored byte-identical from `sdk/ts/makefun-bot.ts`.
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=yj3dej2g&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
