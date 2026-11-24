// Pump.fun Paper Sprint: Any Bot Can Win — early-rise sniper bot.
//
// Buys only new coins that prove early traction (price up, several buys
// already in), then exits fast on take-profit, stop-loss, a trailing stop
// or a hard time exit. Paper trading only: the replay uses market data,
// never real funds. See strategy.ts for the rules; README.md for the
// reasoning behind the parameters.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy } from './strategy.ts';

await runBot(createStrategy());
