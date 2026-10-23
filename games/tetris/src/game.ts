import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { TETRIS_CONFIG } from "./constants";
import { tetrisCatalogEntry } from "./manifest";
import { tetrisRules } from "./rules";
import { parseTetrisObservation } from "./rules/observation";
import { viewTetrisState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { TetrisObservation, TetrisState } from "./sdk";
export { TETRIS_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const tetrisGame = {
  manifest: tetrisCatalogEntry,
  rules: tetrisRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(TETRIS_CONFIG), "Tetris config");
    if (Object.entries(TETRIS_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Tetris config");
    return { ...TETRIS_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): TetrisState {
    const state = viewTetrisState(raw);
    if (
      context.players.length !== 1 ||
      context.players[0]!.slot !== 0 ||
      state.playerId !== context.players[0]!.id
    )
      throw new TypeError("Tetris state participant differs from the single match slot");
    // The engine snapshots parser output at once, so snapshot lists are shared, not copied.
    return state as TetrisState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): TetrisObservation {
    const observation = parseTetrisObservation(raw);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      context.players.length !== 1 ||
      context.players[0]!.slot !== 0 ||
      context.players[0]!.id !== context.playerId
    )
      throw new TypeError("Tetris observation participant or tick mismatch");
    return observation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
