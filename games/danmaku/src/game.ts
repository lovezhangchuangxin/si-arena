import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { DANMAKU_CONFIG } from "./constants";
import { danmakuCatalogEntry } from "./manifest";
import { danmakuRules } from "./rules";
import { parseDanmakuObservation } from "./rules/observation";
import { parseDanmakuState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { DanmakuObservation, DanmakuState } from "./sdk";
export { DANMAKU_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];
/** 每架机体按 slot 坐进对应比赛席位。 */
const seated = (ships: Seats, seats: Seats) =>
  ships.every((ship) => seats[ship.slot]?.id === ship.id);

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const danmakuGame = {
  manifest: danmakuCatalogEntry,
  rules: danmakuRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(DANMAKU_CONFIG), "Danmaku config");
    if (Object.entries(DANMAKU_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Danmaku config");
    return { ...DANMAKU_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): DanmakuState {
    const state = parseDanmakuState(raw);
    if (
      state.ships.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(state.ships, context.players)
    )
      throw new TypeError("Danmaku state participants differ from match slots");
    return state as DanmakuState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): DanmakuObservation {
    const observation = parseDanmakuObservation(raw, context);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      observation.ships.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(observation.ships, context.players)
    )
      throw new TypeError("Danmaku observation participants or tick mismatch");
    return observation as DanmakuObservation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
