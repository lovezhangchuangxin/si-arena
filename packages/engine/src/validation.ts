import {
  cloneJson,
  assertGameResourceLimits,
  DEFAULT_RESOURCE_LIMITS,
  freezeJson,
  resolveResourceLimits,
  snapshotJson,
  stringifyJson,
  toJsonValue,
  utf8Bytes,
  type DeepReadonly,
  type ExecutionError,
  type GameResult,
  type JsonValue,
  type ResourceLimits,
} from "@si-arena/protocol";
import { sha256Hex } from "./sha256";
import {
  ENGINE_COMPATIBILITY,
  EngineError,
  type GameDefinition,
  type ReplayPlayer,
  type StateContext,
} from "./types";

export function record(
  raw: unknown,
  label: string,
  required: readonly string[] = [],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError(`${label} must be an object`);
  const keys = Object.keys(raw);
  if (
    required.some((key) => !Object.hasOwn(raw, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError(`${label} has missing or unexpected fields`);
  return raw as Record<string, unknown>;
}
export function text(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.length)
    throw new TypeError(`${label} must be a nonempty string`);
  return raw;
}
export function integer(raw: unknown, min: number, max: number, label: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < min || raw > max)
    throw new TypeError(`Invalid ${label}`);
  return raw;
}
export function parsePlayers(raw: unknown, min: number, max: number): ReplayPlayer[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max)
    throw new TypeError("Invalid player count");
  const ids = new Set<string>();
  const players = raw
    .map((value): ReplayPlayer => {
      const p = record(value, "player", ["id", "slot", "name", "official"]);
      const id = text(p.id, "player.id");
      if (ids.has(id) || typeof p.official !== "boolean")
        throw new TypeError("Invalid or duplicate participant");
      ids.add(id);
      return {
        id,
        slot: integer(p.slot, 0, raw.length - 1, "player.slot"),
        name: text(p.name, "player.name"),
        official: p.official,
      };
    })
    .toSorted((a, b) => a.slot - b.slot);
  if (players.some((p, i) => p.slot !== i))
    throw new TypeError("Player slots must be unique and contiguous");
  return players;
}
export function parseLimits(raw: unknown): ResourceLimits {
  const value = record(raw, "resolvedLimits", Object.keys(DEFAULT_RESOURCE_LIMITS));
  record(value.logs, "log limits", Object.keys(DEFAULT_RESOURCE_LIMITS.logs));
  return resolveResourceLimits(value as unknown as ResourceLimits);
}
export function gameHeader<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(game: GameDefinition<State, Observation, Action, Event>) {
  const manifest = game.manifest;
  text(manifest.id, "game.id");
  text(manifest.release, "game.release");
  integer(manifest.botProtocolVersion, 1, Number.MAX_SAFE_INTEGER, "botProtocolVersion");
  integer(manifest.minPlayers, 1, Number.MAX_SAFE_INTEGER, "minPlayers");
  integer(manifest.maxPlayers, manifest.minPlayers, Number.MAX_SAFE_INTEGER, "maxPlayers");
  integer(manifest.maxTicks, 1, Number.MAX_SAFE_INTEGER, "maxTicks");
  assertGameResourceLimits(resolveResourceLimits(manifest.resolvedLimits), manifest.maxPlayers);
  return {
    id: manifest.id,
    release: manifest.release,
    botProtocolVersion: manifest.botProtocolVersion,
    engineCompatibility: ENGINE_COMPATIBILITY,
  };
}
export function snapshotGame<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(
  game: GameDefinition<State, Observation, Action, Event>,
): GameDefinition<State, Observation, Action, Event> {
  return {
    ...game,
    manifest: freezeJson(cloneJson(game.manifest)) as typeof game.manifest,
    rules: { ...game.rules },
  };
}
export function checkedState<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(
  game: GameDefinition<State, Observation, Action, Event>,
  raw: unknown,
  tick: number,
  context: StateContext,
): DeepReadonly<State> {
  // One strict walk of the raw world; the parser may then share its frozen parts.
  const state = snapshotJson(game.parseState(snapshotJson(raw), context));
  if (state.tick !== tick)
    throw new EngineError("Rules must start at tick 0 and advance exactly one tick");
  return state;
}
export function parseResult(
  raw: unknown,
  players: readonly ReplayPlayer[],
  tick: number,
  strict = false,
): GameResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("Missing terminal result");
  const value = strict
    ? record(raw, "result", ["reason", "completedTicks", "players"])
    : (raw as Record<string, unknown>);
  const reason = text(value.reason, "result.reason");
  if (
    value.completedTicks !== tick ||
    !Array.isArray(value.players) ||
    value.players.length !== players.length
  )
    throw new TypeError("Invalid result tick or participants");
  const seen = new Map<string, { id: string; rank: number; score: number }>();
  for (const item of value.players) {
    const p = strict
      ? record(item, "result player", ["id", "rank", "score"])
      : (item as Record<string, unknown>);
    const id = text(p.id, "result.player.id");
    if (
      seen.has(id) ||
      !players.some((player) => player.id === id) ||
      typeof p.score !== "number" ||
      !Number.isFinite(p.score)
    )
      throw new TypeError("Invalid result player or score");
    seen.set(id, {
      id,
      rank: integer(p.rank, 1, players.length, "rank"),
      score: p.score === 0 ? 0 : p.score,
    });
  }
  const resultPlayers = players.map((player) => seen.get(player.id)!);
  if (!resultPlayers.some((player) => player.rank === 1))
    throw new TypeError("Result must include a first-place rank");
  return { reason, completedTicks: tick, players: resultPlayers };
}
const ERROR_TYPES = new Set([
  "RUNTIME_ERROR",
  "CPU_LIMIT",
  "HEAP_LIMIT",
  "STACK_LIMIT",
  "MEMORY_LIMIT",
  "MEMORY_INVALID",
  "INVALID_ACTION",
  "ENTRYPOINT_ERROR",
  "EXECUTION_TIMEOUT",
  "EXECUTOR_ERROR",
]);
export function parseError(raw: unknown, limits: ResourceLimits): ExecutionError {
  const e = record(raw, "execution error", ["type", "message"], ["name", "stack"]);
  if (
    typeof e.type !== "string" ||
    !ERROR_TYPES.has(e.type) ||
    typeof e.message !== "string" ||
    (e.name !== undefined && typeof e.name !== "string") ||
    (e.stack !== undefined && typeof e.stack !== "string") ||
    utf8Bytes(stringifyJson(e)) > limits.errorBytes
  )
    throw new TypeError("Invalid bounded execution error");
  return cloneJson(e) as unknown as ExecutionError;
}
export function parseResources(raw: unknown): { cpuUsedUs?: number; memoryBytes?: number } {
  const value = record(raw, "resource measurements", [], ["cpuUsedUs", "memoryBytes"]);
  for (const [key, entry] of Object.entries(value)) integer(entry, 0, Number.MAX_SAFE_INTEGER, key);
  return cloneJson(value) as { cpuUsedUs?: number; memoryBytes?: number };
}
export function canonical(value: unknown): string {
  return stringifyJson(value, { canonical: true });
}
export async function stateHash(state: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(state));
  // crypto.subtle 只在安全上下文暴露；纯 HTTP 浏览器退回本地实现，哈希链保持一致。
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  return sha256Hex(bytes);
}
export function parsedAction<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(
  game: GameDefinition<State, Observation, Action, Event>,
  raw: unknown,
  limits: ResourceLimits,
): Action {
  const input = toJsonValue(raw, limits.actionBytes);
  const parsed = game.rules.parseAction(input);
  if (!parsed.ok) throw new TypeError(`Invalid normalized action: ${parsed.message}`);
  const action = cloneJson(parsed.action, limits.actionBytes);
  if (canonical(action) !== canonical(input))
    throw new TypeError("Recorded/executor actions must already be normalized");
  return action;
}
