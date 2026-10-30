import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { INVESTMENT_CONFIG } from "./constants";
import { investmentCatalogEntry } from "./manifest";
import { investmentRules } from "./rules";
import { parseInvestmentObservation } from "./rules/observation";
import { parseInvestmentState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { InvestmentObservation, InvestmentState } from "./sdk";
export { INVESTMENT_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];
/** 每位交易者按 slot 坐进对应比赛席位。 */
const seated = (traders: Seats, seats: Seats) =>
  traders.every((trader) => seats[trader.slot]?.id === trader.id);

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const investmentGame = {
  manifest: investmentCatalogEntry,
  rules: investmentRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(INVESTMENT_CONFIG), "Investment config");
    if (Object.entries(INVESTMENT_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Investment config");
    return { ...INVESTMENT_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): InvestmentState {
    const state = parseInvestmentState(raw);
    if (
      state.traders.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(state.traders, context.players)
    )
      throw new TypeError("Investment state participants differ from match slots");
    return state as InvestmentState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): InvestmentObservation {
    const observation = parseInvestmentObservation(raw, context);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      observation.traders.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(observation.traders as unknown as Seats, context.players)
    )
      throw new TypeError("Investment observation participants or tick mismatch");
    return observation as InvestmentObservation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
