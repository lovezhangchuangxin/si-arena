import type { DeepReadonly } from "@si-arena/protocol";
import {
  INVESTMENT_ASSET_IDS,
  INVESTMENT_ASSETS,
  INVESTMENT_CONFIG,
  INVESTMENT_MAX_TICKS,
  INVESTMENT_REGIMES,
} from "../constants";
import type {
  InvestmentEvent,
  InvestmentNews,
  InvestmentObservation,
  InvestmentState,
} from "../sdk";
import { readArray, readId, readInteger, readNumber, readRecord } from "./validation";

/** 状态与观察中每资产保留的历史价条数（含当前价）。 */
export const HISTORY_LENGTH = 15;

export function investmentFinished(state: DeepReadonly<InvestmentState>): boolean {
  return state.tick >= state.maxTicks;
}

/** 净资产（元）：现金 + 持仓按当前价估值。 */
export function netWorth(state: DeepReadonly<InvestmentState>, slot: number): number {
  const trader = state.traders[slot];
  if (trader === undefined) throw new TypeError("Unknown trader slot");
  let worth = trader.cash;
  for (let index = 0; index < trader.shares.length; index++) {
    worth += trader.shares[index]! * state.prices[index]!;
  }
  return worth;
}

export function observeInvestment(
  state: DeepReadonly<InvestmentState>,
  playerId: string,
  context?: { events?: DeepReadonly<InvestmentEvent[]> },
): InvestmentObservation | null {
  const self = state.traders.find((trader) => trader.id === playerId);
  if (self === undefined) return null;
  const lastNews = new Map<string, InvestmentNews>();
  for (const news of state.news) lastNews.set(news.asset, news);
  return {
    tick: state.tick,
    maxTicks: state.maxTicks,
    selfId: playerId,
    selfSlot: self.slot,
    regime: state.regime,
    assets: INVESTMENT_ASSET_IDS.map((id, index) => ({
      id,
      name: INVESTMENT_ASSETS[index]!.name,
      price: state.prices[index]!,
      // 开局不足 15 条时左侧用首个历史价补齐，结构恒定。
      history: padHistory([...state.history[index]!]),
      news: (lastNews.get(id) as InvestmentNews | undefined) ?? null,
    })),
    traders: state.traders.map((trader) => ({
      id: trader.id,
      slot: trader.slot,
      cash: trader.cash,
      shares: [...trader.shares],
      fees: trader.fees,
      rejected: trader.rejected,
    })),
    events: (context?.events as InvestmentEvent[] | undefined) ?? [],
  };
}

/** 左侧填充到 HISTORY_LENGTH 条（用最早的历史价，不引入新信息）。 */
function padHistory(series: number[]): number[] {
  if (series.length >= HISTORY_LENGTH) return series;
  const first = series[0]!;
  return Array.from({ length: HISTORY_LENGTH - series.length }, () => first).concat(series);
}

const validObservations = new WeakSet<object>();

/** 校验观察：tick、身份、席位与市场结构必须与世界一致；不含 rngState 等私有字段。 */
export function parseInvestmentObservation(
  raw: unknown,
  context: {
    config: DeepReadonly<Record<string, unknown>>;
    players: ReadonlyArray<{ id: string; slot: number }>;
    playerId: string;
    tick: number;
  },
): InvestmentObservation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("Investment observation must be an object");
  if (validObservations.has(raw)) return raw as InvestmentObservation;
  const value = readRecord(
    raw,
    ["tick", "maxTicks", "selfId", "selfSlot", "regime", "assets", "traders", "events"],
    "Investment observation",
  );
  if (readInteger(value.tick, 0, INVESTMENT_MAX_TICKS, "observation tick") !== context.tick)
    throw new TypeError("observation tick must match the world tick");
  if (
    readInteger(
      value.maxTicks,
      INVESTMENT_MAX_TICKS,
      INVESTMENT_MAX_TICKS,
      "observation maxTicks",
    ) !== INVESTMENT_MAX_TICKS
  )
    throw new TypeError("Unsupported Investment tick limit");
  const selfId = readId(value.selfId);
  if (selfId !== context.playerId) throw new TypeError("observation selfId must be the viewer");
  const selfSlot = readInteger(
    value.selfSlot,
    0,
    context.players.length - 1,
    "observation selfSlot",
  );
  if (context.players[selfSlot]?.id !== selfId)
    throw new TypeError("observation selfSlot must match the viewer seat");
  const regime = INVESTMENT_REGIMES.find((candidate) => candidate === value.regime);
  if (regime === undefined)
    throw new TypeError(`observation regime must be one of ${INVESTMENT_REGIMES.join(" ")}`);
  const assets = parseAssetViews(value.assets);
  const traders = parseObservationTraders(value.traders, context);
  const events = readArray(value.events, (value.events as unknown[]).length, "observation events");
  void events;
  const parsed: InvestmentObservation = {
    tick: context.tick,
    maxTicks: INVESTMENT_MAX_TICKS,
    selfId,
    selfSlot,
    regime,
    assets: assets as InvestmentObservation["assets"],
    traders: traders as InvestmentObservation["traders"],
    events: value.events as unknown[] as InvestmentObservation["events"],
  };
  validObservations.add(parsed);
  return parsed;
}

function parseAssetViews(raw: unknown): InvestmentObservation["assets"] {
  const list = readArray(raw, INVESTMENT_ASSET_IDS.length, "observation assets");
  return list.map((item, index) => {
    const view = readRecord(
      item,
      ["id", "name", "price", "history", "news"],
      `observation asset ${index}`,
    );
    if (view.id !== INVESTMENT_ASSET_IDS[index])
      throw new TypeError("observation assets must follow the fixed asset order");
    const history = readArray(view.history, HISTORY_LENGTH, `asset ${index} history`).map(
      (price, at) =>
        readNumber(price, 1, INVESTMENT_CONFIG.maxPrice, `asset ${index} history ${at}`),
    );
    if (history.at(-1) !== view.price)
      throw new TypeError("asset history must end at the current price");
    const news = view.news === null ? null : parseObservationNews(view.news, `asset ${index} news`);
    return {
      id: view.id as (typeof INVESTMENT_ASSET_IDS)[number],
      name: INVESTMENT_ASSETS[index]!.name,
      price: view.price as number,
      history,
      news,
    };
  });
}

function parseObservationNews(raw: unknown, label: string): InvestmentNews {
  const news = readRecord(raw, ["serial", "tick", "asset", "positive", "magnitudeBps"], label);
  const serial = readInteger(news.serial, 1, Number.MAX_SAFE_INTEGER, `${label} serial`);
  const tick = readInteger(news.tick, 0, INVESTMENT_MAX_TICKS, `${label} tick`);
  const asset = INVESTMENT_ASSET_IDS.find((candidate) => candidate === news.asset);
  if (asset === undefined) throw new TypeError(`${label} asset unknown`);
  if (typeof news.positive !== "boolean") throw new TypeError(`${label} positive must be boolean`);
  const magnitudeBps = readNumber(
    news.magnitudeBps,
    0,
    INVESTMENT_CONFIG.maxMoveBps,
    `${label} magnitudeBps`,
  );
  return { serial, tick, asset, positive: news.positive, magnitudeBps };
}

function parseObservationTraders(
  raw: unknown,
  context: { players: ReadonlyArray<{ id: string; slot: number }> },
): InvestmentObservation["traders"] {
  const list = readArray(raw, context.players.length, "observation traders");
  return list.map((item, slot) => {
    const trader = readRecord(
      item,
      ["id", "slot", "cash", "shares", "fees", "rejected"],
      `observation trader ${slot}`,
    );
    if (readInteger(trader.slot, 0, context.players.length - 1, "trader slot") !== slot)
      throw new TypeError("observation traders must follow the seat order");
    if (trader.id !== context.players[slot]!.id)
      throw new TypeError("observation trader ids must match the match seats");
    readNumber(trader.cash, 0, Number.MAX_SAFE_INTEGER, "trader cash");
    readArray(trader.shares, INVESTMENT_ASSET_IDS.length, "trader shares");
    readNumber(trader.fees, 0, Number.MAX_SAFE_INTEGER, "trader fees");
    readInteger(trader.rejected, 0, Number.MAX_SAFE_INTEGER, "trader rejected");
    return trader as unknown as InvestmentObservation["traders"][number];
  });
}
