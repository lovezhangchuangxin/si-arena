import type { DeepReadonly, JsonObject, JsonValue } from "./json";
import type { ResourceLimitOverrides, ResourceLimits } from "./resources";

/** A single shared arena fed by the game's own leaderboard (for example a battle royale). */
export interface ArenaSettings {
  /** Seats filled from the leaderboard when a run starts. */
  seats: number;
  /** Finished runs kept with their replays; older runs are deleted. */
  keepMatches: number;
  /** Game whose rating breaks ties between equal arena ratings. */
  tieBreakGameId?: string;
}

export interface GameManifest {
  id: string;
  name: string;
  description: string;
  release: string;
  botProtocolVersion: number;
  minPlayers: number;
  maxPlayers: number;
  maxTicks: number;
  config: JsonObject;
  limits?: ResourceLimitOverrides;
  arena?: ArenaSettings;
}

export interface GameCatalogEntry extends Omit<GameManifest, "limits"> {
  resolvedLimits: ResourceLimits;
}

/** True for single-player games: exactly one seat, ranked by best score. */
export const isSoloGame = (game: Pick<GameManifest, "minPlayers" | "maxPlayers">): boolean =>
  game.minPlayers === 1 && game.maxPlayers === 1;

export interface InitInput {
  seed: number;
  players: Array<{ id: string; slot: number }>;
  config: JsonObject;
}

export interface GameResult {
  reason: string;
  completedTicks: number;
  players: Array<{ id: string; rank: number; score: number }>;
}

export type ActionParseResult<Action> =
  | { ok: true; action: Action }
  | { ok: false; message: string };

export interface GameRules<State, Observation, Action, Event> {
  init(input: InitInput): State;
  observe(
    state: DeepReadonly<State>,
    playerId: string,
    context?: { events: DeepReadonly<Event[]> },
  ): Observation | null;
  parseAction(raw: JsonValue): ActionParseResult<Action>;
  defaultAction(state: DeepReadonly<State>, playerId: string): Action;
  step(
    state: DeepReadonly<State>,
    actions: DeepReadonly<Record<string, Action>>,
  ): {
    nextState: State;
    events: Event[];
    result?: GameResult;
  };
}
