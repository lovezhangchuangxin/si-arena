import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import type { INVESTMENT_MAX_TICKS, InvestmentAssetId, InvestmentRegime } from "../constants";

export {
  INVESTMENT_ASSET_IDS,
  INVESTMENT_ASSETS,
  INVESTMENT_REGIMES,
  INVESTMENT_REGIME_SHIFTS,
  INVESTMENT_REGIME_BPS,
  INVESTMENT_CONFIG,
  INVESTMENT_MAX_TICKS,
  INVESTMENT_MIN_PLAYERS,
  INVESTMENT_MAX_PLAYERS,
} from "../constants";
export type { InvestmentAssetId, InvestmentAssetSpec, InvestmentRegime } from "../constants";
export { applyBps } from "../constants";

/** 一笔订单动作：资产、方向与数量；每 tick 每资产最多一单。 */
export type InvestmentAction =
  | { type: "idle" }
  | {
      type: "order";
      asset: InvestmentAssetId;
      /** `buy` 以现金成交、`sell` 清仓式卖出（见结算）。 */
      side: "buy" | "sell";
      /** 数量（份）；恒为 1..maxOrderSize。 */
      quantity: number;
    };

export interface InvestmentTrader {
  id: string;
  slot: number;
  /** 现金（元），恒 ≥ 0；现金不足时买单被拒绝。 */
  cash: number;
  /** 持仓，按 INVESTMENT_ASSET_IDS 顺序；卖出后清零。 */
  shares: number[];
  /** 累计手续费（元）。 */
  fees: number;
  /** 已拒订单数。 */
  rejected: number;
}

export interface InvestmentNews {
  /** 全局递增序号。 */
  serial: number;
  tick: number;
  asset: InvestmentAssetId;
  /** true 利好、false 利空。 */
  positive: boolean;
  /** 实际冲击幅度（万分比），已含随机倍率。 */
  magnitudeBps: number;
}

export interface InvestmentState {
  tick: number;
  maxTicks: typeof INVESTMENT_MAX_TICKS;
  /** 资产 id 顺序见 INVESTMENT_ASSET_IDS；round 中即上一成交价。 */
  prices: number[];
  /** 每资产最近 HISTORY_LENGTH 个 tick 的价格（旧→新，末位为当前价）。 */
  history: number[][];
  /** 本 tick 新产生的新闻事件（无则空）；下一 tick 清空。 */
  news: InvestmentNews[];
  /** 当前市场情绪。 */
  regime: InvestmentRegime;
  /** 已发出新闻总数（serial 单调递增）。 */
  newsCount: number;
  /** xorshift32 状态，无符号 32 位。 */
  rngState: number;
  /** 每位交易者的净资产序列（元）：开局一个点、每 tick 结算后追加，长度恒为 tick + 1。 */
  worthHistory: number[][];
  /** 按席位。 */
  traders: InvestmentTrader[];
}

export interface InvestmentAssetView {
  readonly id: InvestmentAssetId;
  readonly name: string;
  readonly price: number;
  /** 最近 15 个 tick 的历史价格，含当前价，旧→新。 */
  readonly history: readonly number[];
  /** 上一 tick 的新闻；无则 null。 */
  readonly news: InvestmentNews | null;
}

export interface InvestmentObservation {
  tick: number;
  maxTicks: number;
  selfId: string;
  selfSlot: number;
  regime: InvestmentRegime;
  assets: InvestmentAssetView[];
  /** 全体交易者公开持仓与现金（无战争迷雾）。 */
  traders: DeepReadonly<InvestmentTrader[]>;
  /** 上一 tick 的公开事件，tick 0 为空。 */
  events: DeepReadonly<InvestmentEvent[]>;
}

/** 状态中每资产保留的历史价条数（含当前价），观察相同。 */
export const INVESTMENT_HISTORY_LENGTH = 15;

/** 一条公开事件：成交、拒单、现金利息或新闻（新闻已由 assets 展示，仅播报用）。 */
export type InvestmentEvent =
  | {
      type: "trade";
      playerId: string;
      asset: InvestmentAssetId;
      side: "buy" | "sell";
      quantity: number;
      /** 名义成交金额（元）。 */
      value: number;
      fee: number;
      /** 成交后的现金。 */
      cash: number;
    }
  | { type: "rejected"; playerId: string; asset: InvestmentAssetId; side: "buy" | "sell" }
  | { type: "interest"; playerId: string; amount: number; cash: number }
  | { type: "news"; news: InvestmentNews };

export interface InvestmentGameView {
  readonly tick: number;
  readonly maxTicks: number;
  readonly regime: InvestmentRegime;
  readonly assets: readonly InvestmentAssetView[];
  readonly traders: DeepReadonly<InvestmentTrader[]>;
  readonly self: DeepReadonly<InvestmentTrader>;
  readonly events: DeepReadonly<InvestmentEvent[]>;
}

export interface InvestmentTickInput {
  readonly game: InvestmentGameView;
  /** JSON 恢复检查点；tick 失败后全局变量与 SDK 缓存都会丢失。 */
  readonly Memory: JsonObject;
}
