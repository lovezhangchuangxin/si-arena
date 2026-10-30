import { type DeepReadonly, type InitInput } from "@si-arena/protocol";
import {
  INVESTMENT_ASSET_IDS,
  INVESTMENT_ASSETS,
  INVESTMENT_CONFIG,
  INVESTMENT_MAX_CASH,
  INVESTMENT_MAX_PLAYERS,
  INVESTMENT_MAX_SHARES,
  INVESTMENT_MAX_TICKS,
  INVESTMENT_MIN_PLAYERS,
  INVESTMENT_REGIMES,
} from "../constants";
import type { InvestmentNews, InvestmentState, InvestmentTrader } from "../sdk";
import { readArray, readId, readInteger, readNumber, readRecord } from "./validation";

/**
 * 32 位 xorshift32。PRNG 状态随世界保存，回放不重掷：市场进程只由
 * `rngState` 与动作序列决定。返回 [新状态, 0..0xffffffff 无符号值]；
 * 存储恒为无符号，与 parseInvestmentState 的 [0, 2^32) 校验区间一致。
 */
export function nextRandom(state: number): [number, number] {
  let x = state | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const unsigned = x >>> 0;
  return [unsigned, unsigned];
}

/** 首轮空转 + 乘法散列，避免相邻小种子输出线性相关（与 danmaku 同法）。 */
function seedRng(seed: number): number {
  let state = seed | 0;
  for (let warm = 0; warm < 2; warm++) {
    state = nextRandom(state)[0];
  }
  // 0 是 xorshift32 不动点；混入常数跳开。
  return state === 0 ? 0x9e3779b9 : state;
}

/** [0, 1) 均匀浮点。 */
const unit = (state: number): [number, number] => {
  const [next, value] = nextRandom(state);
  return [next, value / 0x1_0000_0000];
};

const initialTrader = (id: string, slot: number): InvestmentTrader => ({
  id,
  slot,
  cash: INVESTMENT_CONFIG.initialCash,
  shares: INVESTMENT_ASSET_IDS.map(() => 0),
  fees: 0,
  rejected: 0,
});

export function initInvestment(input: InitInput): InvestmentState {
  const players = input.players;
  if (players.length < INVESTMENT_MIN_PLAYERS || players.length > INVESTMENT_MAX_PLAYERS)
    throw new TypeError("Investment requires 2 to 4 players");
  if (players.some((seat, slot) => seat.slot !== slot))
    throw new TypeError("Investment seats must be dense");
  return {
    tick: 0,
    maxTicks: INVESTMENT_MAX_TICKS,
    prices: INVESTMENT_ASSETS.map((asset) => asset.price0),
    history: INVESTMENT_ASSETS.map((asset) => [asset.price0]),
    news: [],
    regime: "flat",
    newsCount: 0,
    rngState: seedRng(input.seed),
    worthHistory: players.map(() => [INVESTMENT_CONFIG.initialCash]),
    traders: players.map(({ id, slot }) => initialTrader(id, slot)),
  };
}

/** 解析时的价格上限放宽一档（防合法回放被误拒），真实上界见 maxPrice。 */
const PARSE_PRICE_CAP = INVESTMENT_CONFIG.maxPrice;
/** 解析时允许的历史长度上限（观察恒为 15，状态早期不足 15）。 */
const HISTORY_LENGTH_CAP = 15;

const validStates = new WeakSet<object>();

export function parseInvestmentState(raw: unknown): DeepReadonly<InvestmentState> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("Investment state must be an object");
  if (validStates.has(raw)) return raw as DeepReadonly<InvestmentState>;
  const state = readRecord(
    raw,
    [
      "tick",
      "maxTicks",
      "prices",
      "history",
      "news",
      "regime",
      "newsCount",
      "rngState",
      "worthHistory",
      "traders",
    ],
    "Investment state",
  );
  const tick = readInteger(state.tick, 0, INVESTMENT_MAX_TICKS, "state tick");
  if (
    readInteger(state.maxTicks, INVESTMENT_MAX_TICKS, INVESTMENT_MAX_TICKS, "state maxTicks") !==
    INVESTMENT_MAX_TICKS
  )
    throw new TypeError("Unsupported Investment tick limit");
  const players = (state.traders as unknown[]).length;
  if (players < INVESTMENT_MIN_PLAYERS || players > INVESTMENT_MAX_PLAYERS)
    throw new TypeError("Investment state traders out of range");
  const prices = readArray(state.prices, INVESTMENT_ASSET_IDS.length, "state prices").map(
    (price, index) => readNumber(price, 1, PARSE_PRICE_CAP, `state price ${index}`),
  );
  const history = readArray(state.history, INVESTMENT_ASSET_IDS.length, "state history").map(
    (series, index) => {
      const list = Array.isArray(series)
        ? series
        : (() => {
            throw new TypeError(`state history ${index} must be an array`);
          })();
      if (list.length === 0 || list.length > HISTORY_LENGTH_CAP)
        throw new TypeError(`state history ${index} length out of range`);
      const values = list.map((price, at) =>
        readNumber(price, 1, PARSE_PRICE_CAP, `state history ${index} ${at}`),
      );
      if (values.at(-1) !== prices[index])
        throw new TypeError(`state history ${index} must end at the current price`);
      return values;
    },
  );
  const regime = readRegime(state.regime);
  const newsCount = readInteger(state.newsCount, 0, Number.MAX_SAFE_INTEGER, "state newsCount");
  const rngState = readInteger(state.rngState, 0, 0xffff_ffff, "state rngState");
  const traders = parseTraders(state.traders, players);
  // 净值序列长度恒为 tick + 1，末位与当前净值一致。
  const worthHistory = readArray(state.worthHistory, players, "state worthHistory").map(
    (series, slot) => {
      if (!Array.isArray(series))
        throw new TypeError(`state worthHistory ${slot} must be an array`);
      if (series.length !== tick + 1)
        throw new TypeError(`state worthHistory ${slot} must have tick + 1 entries`);
      const values = series.map((worth, at) =>
        readNumber(worth, 0, Number.MAX_SAFE_INTEGER, `state worthHistory ${slot} ${at}`),
      );
      const trader = traders[slot]!;
      const current =
        trader.cash +
        trader.shares.reduce((sum, shares, index) => sum + shares * prices[index]!, 0);
      if (values.at(-1) !== current)
        throw new TypeError(`state worthHistory ${slot} must end at the current net worth`);
      return values;
    },
  );
  const news = parseNewsList(state.news);
  if (news.some((item) => item.tick > tick))
    throw new TypeError("News from the future are invalid");
  const parsed: InvestmentState = {
    tick,
    maxTicks: INVESTMENT_MAX_TICKS,
    prices,
    history,
    news,
    regime,
    newsCount,
    rngState,
    worthHistory,
    traders,
  };
  validStates.add(parsed);
  return parsed;
}

function readRegime(raw: unknown): InvestmentState["regime"] {
  const regime = INVESTMENT_REGIMES.find((candidate) => candidate === raw);
  if (regime === undefined)
    throw new TypeError(`state regime must be one of ${INVESTMENT_REGIMES.join(" ")}`);
  return regime;
}

function parseTraders(raw: unknown, players: number): InvestmentTrader[] {
  return readArray(raw, players, "state traders").map((trader, slot) => {
    const record = readRecord(
      trader,
      ["id", "slot", "cash", "shares", "fees", "rejected"],
      `trader ${slot}`,
    );
    return {
      id: readId(record.id),
      slot: readInteger(record.slot, slot, slot, `trader ${slot} slot`),
      cash: readNumber(record.cash, 0, INVESTMENT_MAX_CASH, `trader ${slot} cash`),
      shares: readArray(record.shares, INVESTMENT_ASSET_IDS.length, `trader ${slot} shares`).map(
        (share, index) =>
          readInteger(share, 0, INVESTMENT_MAX_SHARES, `trader ${slot} share ${index}`),
      ),
      fees: readNumber(record.fees, 0, Number.MAX_SAFE_INTEGER, `trader ${slot} fees`),
      rejected: readInteger(record.rejected, 0, Number.MAX_SAFE_INTEGER, `trader ${slot} rejected`),
    };
  });
}

function parseNewsList(raw: unknown): InvestmentNews[] {
  if (raw === null || typeof raw !== "object" || !Array.isArray(raw))
    throw new TypeError("state news must be an array");
  if (Reflect.ownKeys(raw).length !== raw.length + 1)
    throw new TypeError("state news must be a dense array");
  return raw.map((item, index) => {
    const record = readRecord(
      item,
      ["serial", "tick", "asset", "positive", "magnitudeBps"],
      `news ${index}`,
    );
    return {
      serial: readInteger(record.serial, 1, Number.MAX_SAFE_INTEGER, `news ${index} serial`),
      tick: readInteger(record.tick, 0, INVESTMENT_MAX_TICKS, `news ${index} tick`),
      asset: readAsset(record.asset, `news ${index} asset`),
      positive: readBoolean(record.positive, `news ${index} positive`),
      magnitudeBps: readNumber(
        record.magnitudeBps,
        0,
        INVESTMENT_CONFIG.maxMoveBps,
        `news ${index} magnitudeBps`,
      ),
    };
  });
}

function readAsset(raw: unknown, label: string): InvestmentNews["asset"] {
  const asset = INVESTMENT_ASSET_IDS.find((candidate) => candidate === raw);
  if (asset === undefined)
    throw new TypeError(`${label} must be one of ${INVESTMENT_ASSET_IDS.join(" ")}`);
  return asset;
}

function readBoolean(raw: unknown, label: string): boolean {
  if (typeof raw !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return raw;
}

/** 现金利息（向上取整）。 */
export function interestFor(cash: number): number {
  return Math.ceil((cash * INVESTMENT_CONFIG.interestBps) / 10_000);
}

export { unit };
