import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { CUBE_CONFIG } from "./constants";
import { cubeCatalogEntry } from "./manifest";
import { cubeRules } from "./rules";
import { parseCubeObservation } from "./rules/observation";
import { viewCubeState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { CubeObservation, CubeState } from "./sdk";
export { CUBE_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const cubeGame = {
  manifest: cubeCatalogEntry,
  rules: cubeRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(CUBE_CONFIG), "Cube config");
    if (Object.entries(CUBE_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Cube config");
    return { ...CUBE_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): CubeState {
    const state = viewCubeState(raw);
    if (
      context.players.length !== 1 ||
      context.players[0]!.slot !== 0 ||
      state.playerId !== context.players[0]!.id
    )
      throw new TypeError("Cube state participant differs from the single match slot");
    // The engine snapshots parser output at once, so snapshot lists are shared, not copied.
    return state as CubeState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): CubeObservation {
    const observation = parseCubeObservation(raw);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      context.players.length !== 1 ||
      context.players[0]!.slot !== 0 ||
      context.players[0]!.id !== context.playerId
    )
      throw new TypeError("Cube observation participant or tick mismatch");
    return observation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
