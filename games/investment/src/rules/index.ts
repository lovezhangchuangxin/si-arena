import {
  type DeepReadonly,
  type GameResult,
  type GameRules,
  type InitInput,
} from "@si-arena/protocol";
import {
  INVESTMENT_ASSET_IDS,
  INVESTMENT_ASSETS,
  INVESTMENT_CONFIG,
  INVESTMENT_REGIME_BPS,
  INVESTMENT_REGIME_SHIFTS,
  INVESTMENT_REGIMES,
  applyBps,
  clamp,
} from "../constants";
import type {
  InvestmentAction,
  InvestmentEvent,
  InvestmentNews,
  InvestmentObservation,
  InvestmentState,
} from "../sdk";
import { parseInvestmentAction } from "./actions";
import { HISTORY_LENGTH, investmentFinished, netWorth, observeInvestment } from "./observation";
import { initInvestment, interestFor, unit } from "./state";
export { parseInvestmentAction } from "./actions";
export { parseInvestmentState, initInvestment } from "./state";
export {
  investmentFinished,
  netWorth,
  observeInvestment,
  parseInvestmentObservation,
  HISTORY_LENGTH,
} from "./observation";
export type { InvestmentEvent } from "../sdk";

export interface InvestmentResult extends GameResult {
  /** `tick-limit` 固定 240 tick 收盘。 */
  reason: "tick-limit";
  players: Array<{ id: string; rank: number; score: number; worth: number }>;
}

export interface InvestmentStepResult {
  nextState: InvestmentState;
  events: InvestmentEvent[];
  result?: InvestmentResult;
}

export interface InvestmentRules extends GameRules<
  InvestmentState,
  InvestmentObservation,
  InvestmentAction,
  InvestmentEvent
> {
  step(
    state: DeepReadonly<InvestmentState>,
    actions: DeepReadonly<Record<string, InvestmentAction>>,
  ): InvestmentStepResult;
}

/** 手续费：名义金额 × feeBps，向上取整（至少 1 元）。 */
function feeFor(value: number): number {
  return Math.max(1, Math.ceil((value * INVESTMENT_CONFIG.feeBps) / 10_000));
}

/** step 从不改输入世界。 */
function workingCopy(state: DeepReadonly<InvestmentState>): InvestmentState {
  return {
    ...state,
    prices: [...state.prices],
    history: state.history.map((series) => [...series]),
    news: [],
    worthHistory: state.worthHistory.map((series) => [...series]),
    traders: state.traders.map((trader) => ({
      ...trader,
      shares: [...trader.shares],
    })),
  };
}

/** 名次：净值降序，并列同名次（1,1,3 制）。 */
function outcome(state: InvestmentState): InvestmentResult | undefined {
  if (!investmentFinished(state)) return undefined;
  const worths = state.traders.map((trader) => netWorth(state, trader.slot));
  const sorted = worths.toSorted((a, b) => b - a);
  return {
    reason: "tick-limit",
    completedTicks: state.tick,
    players: state.traders.map((trader) => {
      const worth = worths[trader.slot]!;
      return {
        id: trader.id,
        rank: sorted.indexOf(worth) + 1,
        score: worth,
        worth,
      };
    }),
  };
}

export const investmentRules: InvestmentRules = {
  init(input: InitInput): InvestmentState {
    return initInvestment(input);
  },

  observe(state, playerId, context) {
    return observeInvestment(state, playerId, context);
  },

  parseAction(raw) {
    return parseInvestmentAction(raw);
  },

  defaultAction() {
    return { type: "idle" };
  },

  step(state, actions): InvestmentStepResult {
    const next = workingCopy(state);
    const events: InvestmentEvent[] = [];

    // ── 阶段 1：按席位顺序撮合订单 ────────────────────────────
    // 每 tick 每资产每人最多一单（动作 schema 已保证）；买单需要
    // 现金 ≥ 名义金额 + 手续费，卖单数量 ≤ 持仓。被拒订单计数并
    // 发 rejected 事件，不产生任何资金变动。撮合顺序不影响结果：
    // 成交价恒为撮合前的市场价，市场影响统一在阶段 3 结算。
    const netFlows = INVESTMENT_ASSET_IDS.map(() => 0);
    for (const trader of next.traders) {
      const action: InvestmentAction | undefined = actions[trader.id];
      if (action === undefined || action.type !== "order") continue;
      const assetIndex = INVESTMENT_ASSET_IDS.indexOf(action.asset);
      if (assetIndex < 0) continue;
      const price = next.prices[assetIndex]!;
      if (action.side === "buy") {
        const value = action.quantity * price;
        const fee = feeFor(value);
        if (value + fee > trader.cash) {
          trader.rejected += 1;
          events.push({ type: "rejected", playerId: trader.id, asset: action.asset, side: "buy" });
          continue;
        }
        trader.cash -= value + fee;
        trader.shares[assetIndex]! += action.quantity;
        trader.fees += fee;
        netFlows[assetIndex]! += value;
        events.push({
          type: "trade",
          playerId: trader.id,
          asset: action.asset,
          side: "buy",
          quantity: action.quantity,
          value,
          fee,
          cash: trader.cash,
        });
      } else {
        const held = trader.shares[assetIndex]!;
        if (action.quantity > held) {
          trader.rejected += 1;
          events.push({
            type: "rejected",
            playerId: trader.id,
            asset: action.asset,
            side: "sell",
          });
          continue;
        }
        const value = action.quantity * price;
        const fee = feeFor(value);
        trader.cash += value - fee;
        trader.shares[assetIndex] = held - action.quantity;
        trader.fees += fee;
        netFlows[assetIndex]! -= value;
        events.push({
          type: "trade",
          playerId: trader.id,
          asset: action.asset,
          side: "sell",
          quantity: action.quantity,
          value,
          fee,
          cash: trader.cash,
        });
      }
    }

    // ── 阶段 2：现金利息 ──────────────────────────────────────
    for (const trader of next.traders) {
      if (trader.cash <= 0) continue;
      const amount = interestFor(trader.cash);
      trader.cash += amount;
      events.push({ type: "interest", playerId: trader.id, amount, cash: trader.cash });
    }

    // ── 阶段 3：市场演化（regime → 新闻 → 定价）────────────────
    // 3a. regime 转移：对角线外每格单独掷骰，先到先得。
    let rng = next.rngState;
    const shifts = INVESTMENT_REGIME_SHIFTS[next.regime];
    let regime = next.regime;
    for (const candidate of INVESTMENT_REGIMES) {
      if (candidate === regime) continue;
      const chance = shifts[candidate]!;
      const draw = unit(rng);
      rng = draw[0];
      if (draw[1]! < chance / 10_000) {
        regime = candidate;
        break;
      }
    }
    next.regime = regime;

    // 3b. 新闻：每资产独立 2.5% 概率，利好/利空等概率，
    // 幅度 = shockBps × [0.5, 1.5)。
    const news: InvestmentNews[] = [];
    for (let index = 0; index < INVESTMENT_ASSETS.length; index++) {
      const spec = INVESTMENT_ASSETS[index]!;
      const chanceDraw = unit(rng);
      rng = chanceDraw[0];
      if (chanceDraw[1]! >= INVESTMENT_CONFIG.eventChancePerMyriad / 10_000) continue;
      const signDraw = unit(rng);
      rng = signDraw[0];
      const magnitudeDraw = unit(rng);
      rng = magnitudeDraw[0];
      const positive = signDraw[1]! < 0.5;
      // 幅度 = shockBps × [0.5, 1.5)，再钳制在单 tick 总涨跌幅内。
      const magnitudeBps = Math.min(
        INVESTMENT_CONFIG.maxMoveBps,
        Math.round(spec.shockBps * (0.5 + magnitudeDraw[1]!)),
      );
      news.push({
        serial: next.newsCount + news.length + 1,
        tick: next.tick + 1,
        asset: spec.id,
        positive,
        magnitudeBps,
      });
    }
    next.news = news;
    next.newsCount += news.length;
    for (const item of news) events.push({ type: "news", news: item });

    // 3c. 定价：漂移 + regime 因子 + 市场噪声 + 新闻 + 订单流影响，
    // 全部以万分比合并后一次性应用到整数价格上。
    const factorBps = INVESTMENT_REGIME_BPS[regime];
    for (let index = 0; index < INVESTMENT_ASSETS.length; index++) {
      const spec = INVESTMENT_ASSETS[index]!;
      const noiseDraw = unit(rng);
      rng = noiseDraw[0];
      // 均匀噪声：[-sigma, sigma) bps。
      const noiseBps = Math.floor(noiseDraw[1]! * 2 * spec.sigmaBps) - spec.sigmaBps;
      const newsBps = news
        .filter((item) => item.asset === spec.id)
        .reduce((sum, item) => sum + (item.positive ? item.magnitudeBps : -item.magnitudeBps), 0);
      const impactBps = clamp(
        Math.round((netFlows[index]! / spec.liquidity) * 10_000),
        -INVESTMENT_CONFIG.maxImpactBps,
        INVESTMENT_CONFIG.maxImpactBps,
      );
      let totalBps =
        spec.driftBps +
        Math.round((factorBps * spec.betaTenths) / 10) +
        noiseBps +
        newsBps +
        impactBps;
      totalBps = clamp(totalBps, -INVESTMENT_CONFIG.maxMoveBps, INVESTMENT_CONFIG.maxMoveBps);
      const advanced = applyBps(next.prices[index]!, totalBps);
      next.prices[index] = clamp(advanced, 1, INVESTMENT_CONFIG.maxPrice);
      const series = next.history[index]!;
      series.push(next.prices[index]!);
      if (series.length > HISTORY_LENGTH) series.shift();
    }
    next.rngState = rng;

    // ── 阶段 4：记录净值序列（结算后价格估值），推进 tick ─────
    for (const trader of next.traders) {
      next.worthHistory[trader.slot]!.push(netWorth(next, trader.slot));
    }
    next.tick += 1;
    const result = outcome(next);
    return result === undefined ? { nextState: next, events } : { nextState: next, events, result };
  },
};
