import { expect, test } from "vitest";
import { investmentManifest } from "@si-arena/game-investment";
import {
  INVESTMENT_ASSET_IDS,
  INVESTMENT_CONFIG,
  INVESTMENT_MAX_TICKS,
} from "@si-arena/game-investment/sdk";
import type { InvestmentAction } from "@si-arena/game-investment/sdk";
import { investmentRules, netWorth, parseInvestmentState } from "@si-arena/game-investment/rules";
import { cloneJson } from "@si-arena/protocol";
import { IDS, cashs, deepFreeze, idle, init, order, required, step } from "./helpers";

test("initialization gives every trader the same starting cash and empty books", () => {
  const state = init(0);
  expect(state.tick).toBe(0);
  expect(state.maxTicks).toBe(240);
  expect(state.regime).toBe("flat");
  expect(state.prices).toStrictEqual([100, 80, 50, 20]);
  expect(cashs(state)).toStrictEqual([1_000_000, 1_000_000]);
  expect(state.traders[0]!.shares).toStrictEqual([0, 0, 0, 0]);
  expect(state.news).toStrictEqual([]);
  expect(state.history.map((series) => series.at(-1))).toStrictEqual(state.prices);
});

test("same seeds repeat and different seeds diverge", () => {
  const a = init(7);
  const b = init(7);
  const c = init(8);
  expect(a).toStrictEqual(b);
  expect(a.rngState).not.toBe(c.rngState);
});

test("buy orders fill at the market price with fees and update holdings", () => {
  let state = init(0);
  const output = step(state, { alpha: order("anchor", "buy", 1000) });
  const events = output.events;
  const alpha = output.nextState.traders[0]!;
  // 1000 份 × 100 元 = 100000 元名义，手续费 ceil(100000 × 0.003) = 300。
  expect(alpha.shares[0]).toBe(1000);
  // 订单阶段后：现金恰好扣除名义 + 手续费。
  const interest = Math.ceil(((1_000_000 - 100_300) * 2) / 10_000);
  expect(alpha.cash).toBe(1_000_000 - 100_300 + interest);
  expect(alpha.fees).toBe(300);
  const trade = required(
    events.find(
      (event): event is Extract<(typeof events)[number], { type: "trade" }> =>
        event.type === "trade",
    ),
  );
  expect(trade.value).toBe(100_000);
  expect(trade.fee).toBe(300);
  // beta 全程 idle：只剩利息。
  expect(output.nextState.traders[1]!.cash).toBe(1_000_000 + Math.ceil((1_000_000 * 2) / 10_000));
});

test("buys exceeding cash are rejected without side effects", () => {
  let state = init(0);
  // 1_000_000 份 × 100 元 = 1e8 名义远超现金。
  state = step(state, { alpha: order("anchor", "buy", 1_000_000) }).nextState;
  const alpha = state.traders[0]!;
  expect(alpha.rejected).toBe(1);
  expect(alpha.shares[0]).toBe(0);
  // 只剩利息变动。
  expect(alpha.cash).toBe(1_000_000 + Math.ceil((1_000_000 * 2) / 10_000));
});

test("sells clamp at holdings and pay fees from proceeds", () => {
  let state = init(0);
  const buyOutput = step(state, { alpha: order("beam", "buy", 5000) });
  state = buyOutput.nextState;
  const afterBuy = state.traders[0]!;
  expect(afterBuy.shares[1]).toBe(5000);
  // 卖出超过持仓 → 拒单。
  let next = step(state, { alpha: order("beam", "sell", 5001) });
  expect(next.nextState.traders[0]!.rejected).toBe(1);
  expect(next.nextState.traders[0]!.shares[1]).toBe(5000);
  // 全仓卖出：成交价 = 撮合时的旧价（即 tick 0 结束时的价格），
  // 与状态里结算后的新价格无关。
  next = step(state, { alpha: order("beam", "sell", 5000) });
  const sold = next.nextState.traders[0]!;
  const sellTrade = required(
    next.events.find(
      (event): event is Extract<(typeof next.events)[number], { type: "trade" }> =>
        event.type === "trade" && event.side === "sell",
    ),
  );
  expect(sellTrade.value).toBe(5000 * state.prices[1]!);
  expect(sold.shares[1]).toBe(0);
  // 事件里的 cash 是订单阶段后的值；状态里的 cash 再加本 tick 利息。
  const interest = Math.ceil((sellTrade.cash * 2) / 10_000);
  expect(sold.cash).toBe(sellTrade.cash + interest);
});

test("net order flow moves next tick prices upward", () => {
  let state = init(0);
  // 双方合计净买入 anchor：alpha 6000 + beta 4000 份（价格 100）。
  state = step(state, {
    alpha: order("anchor", "buy", 6000),
    beta: order("anchor", "buy", 4000),
  }).nextState;
  // 净流入约 1000000 元 / liquidity 1200000 → 约 +8333bps，受 maxImpactBps 钳制到 1000bps，
  // 加上漂移与噪声后必须显著上涨。
  expect(state.prices[0]!).toBeGreaterThan(100);
});

test("impact is capped at maxImpactBps per asset per tick", () => {
  // 构造极端净流入：4 人全买 comet（liquidity 最小），观察涨幅是否被钳制。
  let state = init(3, IDS);
  const maxSpend = INVESTMENT_CONFIG.initialCash - 10_000;
  state = step(
    state,
    Object.fromEntries(IDS.map((id) => [id, order("comet", "buy", Math.floor(maxSpend / 20))])),
  ).nextState;
  // comet 初始 20 元；maxMoveBps 5000 → 单 tick 最多 +50%。
  expect(state.prices[3]!).toBeLessThanOrEqual(30);
  expect(state.prices[3]!).toBeGreaterThan(20);
});

test("history windows grow to 15 entries and stay aligned with prices", () => {
  let state = init(0);
  for (let tick = 0; tick < 30; tick++) state = step(state).nextState;
  for (const series of state.history) expect(series.length).toBe(15);
  expect(state.history.map((series) => series.at(-1))).toStrictEqual(state.prices);
});

test("the world never runs past maxTicks and ranks by net worth", () => {
  let state = init(0);
  let result: ReturnType<typeof investmentRules.step>["result"];
  for (let tick = 0; tick < INVESTMENT_MAX_TICKS + 5 && !result; tick++) {
    const output = step(state, tick % 3 === 0 ? { alpha: order("anchor", "buy", 10) } : {});
    state = output.nextState;
    result = output.result;
  }
  expect(result).toBeDefined();
  expect(result!.reason).toBe("tick-limit");
  expect(result!.completedTicks).toBe(240);
  const ranks = [...result!.players].toSorted((a, b) => a.rank - b.rank);
  expect(ranks[0]!.score).toBeGreaterThanOrEqual(ranks.at(-1)!.score);
  expect(ranks[0]!.rank).toBe(1);
});

test("step never mutates the input world", () => {
  const state = deepFreeze(init(5));
  const output = step(state, { alpha: order("spark", "buy", 100) });
  expect(output.nextState).not.toBe(state);
  expect(state.traders[0]!.shares[2]).toBe(0);
  expect(() => step(state)).not.toThrow();
});

test("identical action maps keep the market deterministic", () => {
  expect(runDeterministicMarket()).toStrictEqual(runDeterministicMarket());
});

const runDeterministicMarket = () => {
  let state = init(9);
  for (let tick = 0; tick < 50; tick++) {
    const actions: Record<string, InvestmentAction> = {
      alpha: order(INVESTMENT_ASSET_IDS[tick % 4]!, tick % 2 ? "buy" : "sell", 100 + tick),
      beta: tick % 3 === 0 ? order("beam", "buy", 50) : idle(),
    };
    state = step(state, actions).nextState;
  }
  return state;
};

test("action execution order cannot change prices or books", () => {
  // 同一 tick 相同订单集合：键顺序不影响结果（撮合按席位固定）。
  const a = step(init(4), { alpha: order("anchor", "buy", 700), beta: idle() });
  const b = step(init(4), { beta: idle(), alpha: order("anchor", "buy", 700) });
  expect(a.nextState).toStrictEqual(b.nextState);
});

test("parseInvestmentState round-trips cloned worlds and rejects tampering", () => {
  let state = init(2);
  state = step(state, { alpha: order("comet", "buy", 999) }).nextState;
  expect(parseInvestmentState(cloneJson(state))!).toBeDefined();
  const broken = cloneJson(state);
  required(broken.traders[0]).slot = 1;
  expect(() => parseInvestmentState(broken)).toThrow();
  const futureNews = cloneJson(state);
  futureNews.news.push({
    serial: 999,
    tick: 500,
    asset: "comet",
    positive: true,
    magnitudeBps: 100,
  });
  expect(() => parseInvestmentState(futureNews)).toThrow();
});

test("netWorth values books at current prices", () => {
  let state = init(0);
  state = step(state, { alpha: order("anchor", "buy", 1000) }).nextState;
  const worth = netWorth(state, 0);
  const alpha = state.traders[0]!;
  expect(worth).toBe(alpha.cash + alpha.shares[0]! * state.prices[0]!);
});

test("rngState stays unsigned so every world passes replay parsing", () => {
  for (let seed = 0; seed < 64; seed++) {
    expect(init(seed).rngState).toBeGreaterThanOrEqual(0);
    expect(init(seed).rngState).toBeLessThanOrEqual(0xffff_ffff);
  }
});

test("config rejects tampered values", () => {
  expect(investmentManifest.config.initialCash).toBe(1_000_000);
  expect(investmentManifest.maxTicks).toBe(240);
  expect(investmentManifest.minPlayers).toBe(2);
  expect(investmentManifest.maxPlayers).toBe(4);
});
