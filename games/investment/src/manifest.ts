import {
  INVESTMENT_CONFIG,
  INVESTMENT_MAX_PLAYERS,
  INVESTMENT_MAX_TICKS,
  INVESTMENT_MIN_PLAYERS,
} from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const investmentManifest = {
  id: "investment",
  name: "模拟投资",
  description:
    "最多四名交易者同场，在牛熊交替的市场里买卖四种风险各异的资产，新闻、利息与手续费之间追高净值，240 tick 收盘时净值最高者获胜。",
  release: "investment@0.1.0",
  botProtocolVersion: 1,
  minPlayers: INVESTMENT_MIN_PLAYERS,
  maxPlayers: INVESTMENT_MAX_PLAYERS,
  maxTicks: INVESTMENT_MAX_TICKS,
  config: INVESTMENT_CONFIG,
  arena: { seats: 4, keepMatches: 3, tieBreakGameId: "paper" },
} satisfies GameManifest;

export const investmentCatalogEntry: GameCatalogEntry = {
  ...investmentManifest,
  resolvedLimits: resolveResourceLimits(),
};
