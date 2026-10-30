/** 资产标识；数组、观察与动作中的资产顺序恒为此处顺序。 */
export const INVESTMENT_ASSET_IDS = Object.freeze(["anchor", "beam", "spark", "comet"] as const);
export type InvestmentAssetId = (typeof INVESTMENT_ASSET_IDS)[number];

/**
 * 资产参数表（不在 config 中，随规则固定）：
 * - `price0` 初始价；`driftBps` 每 tick 漂移；`sigmaBps` 每 tick 均匀噪声幅度；
 * - `betaTenths` 对市场因子的十分位敏感度（4 → 0.4 倍）；
 * - `shockBps` 新闻事件基准幅度，实际幅度为 [0.5, 1.5) 倍；
 * - `liquidity` 资金深度（元）：净流入资金 / liquidity 即推动的万分比，再钳制 ±maxImpactBps。
 */
export interface InvestmentAssetSpec {
  readonly id: InvestmentAssetId;
  readonly name: string;
  readonly price0: number;
  readonly driftBps: number;
  readonly sigmaBps: number;
  readonly betaTenths: number;
  readonly shockBps: number;
  readonly liquidity: number;
}

export const INVESTMENT_ASSETS: readonly InvestmentAssetSpec[] = Object.freeze([
  {
    id: "anchor",
    name: "锚石基金",
    price0: 100,
    driftBps: 2,
    sigmaBps: 25,
    betaTenths: 4,
    shockBps: 800,
    liquidity: 1_200_000,
  },
  {
    id: "beam",
    name: "恒梁实业",
    price0: 80,
    driftBps: 4,
    sigmaBps: 60,
    betaTenths: 8,
    shockBps: 1500,
    liquidity: 1_000_000,
  },
  {
    id: "spark",
    name: "星火科技",
    price0: 50,
    driftBps: 8,
    sigmaBps: 110,
    betaTenths: 13,
    shockBps: 2500,
    liquidity: 800_000,
  },
  {
    id: "comet",
    name: "彗星币",
    price0: 20,
    driftBps: 12,
    sigmaBps: 220,
    betaTenths: 18,
    shockBps: 4000,
    liquidity: 400_000,
  },
]);

/** 市场情绪：影响全部资产的共同因子，由 PRNG 按转移表演化。 */
export const INVESTMENT_REGIMES = Object.freeze(["bull", "flat", "bear"] as const);
export type InvestmentRegime = (typeof INVESTMENT_REGIMES)[number];

/**
 * regime 每 tick 转移概率（万分比）。行按当前状态、列按目标状态；
 * 剩余概率保持原状态。对角线之外的每一格单独与均匀随机数比较。
 */
export const INVESTMENT_REGIME_SHIFTS: Readonly<
  Record<InvestmentRegime, Readonly<Record<InvestmentRegime, number>>>
> = Object.freeze({
  bull: Object.freeze({ bull: 0, flat: 1200, bear: 200 }),
  flat: Object.freeze({ bull: 400, flat: 0, bear: 400 }),
  bear: Object.freeze({ bull: 200, flat: 1200, bear: 0 }),
});

/** regime 对市场因子的固定贡献（万分比）。 */
export const INVESTMENT_REGIME_BPS: Readonly<Record<InvestmentRegime, number>> = Object.freeze({
  bull: 30,
  flat: 0,
  bear: -30,
});

export const INVESTMENT_CONFIG = Object.freeze({
  /** 每位玩家的初始现金（元）。 */
  initialCash: 1_000_000,
  /** 现金每 tick 利息（万分比）。 */
  interestBps: 2,
  /** 成交手续费（万分比，向上取整）。 */
  feeBps: 30,
  /** 单资产单 tick 市场影响上限（万分比）。 */
  maxImpactBps: 1000,
  /** 每 tick 每玩家订单数上限（每资产最多一单，恰好覆盖全部资产）。 */
  maxOrdersPerTick: 4,
  /** 单订单数量的绝对值上限（份）。 */
  maxOrderSize: 1_000_000,
  /** 价格硬区间上限；下限恒为 1。 */
  maxPrice: 1_000_000_000,
  /** 单 tick 单资产总收益（漂移 + 因子 + 噪声 + 事件 + 影响）钳制（万分比）。 */
  maxMoveBps: 5000,
  /** 每资产每 tick 新闻事件概率（万分比）。 */
  eventChancePerMyriad: 250,
  /** 市场因子噪声幅度（万分比）。 */
  marketNoiseBps: 15,
} as const);

export const INVESTMENT_MAX_TICKS = 240;
export const INVESTMENT_MIN_PLAYERS = 2;
export const INVESTMENT_MAX_PLAYERS = 4;

/** 数值安全论证见 docs/designs/investment.md：净值上界 8e15 < 2^53。
 * 每份价格 ≥ 1 元，故持仓份数上界与现金上界一致。 */
export const INVESTMENT_MAX_CASH = 8_000_000_000_000_000;
export const INVESTMENT_MAX_SHARES = INVESTMENT_MAX_CASH;

/** 万分比定点乘法（四舍五入到最近整数，正负对称，无系统性偏差）。 */
export function applyBps(value: number, bps: number): number {
  if (bps >= 0) return Math.floor((value * (10_000 + bps) + 5_000) / 10_000);
  return Math.ceil((value * (10_000 + bps) - 5_000) / 10_000);
}

/** 钳制到闭区间。 */
export const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
