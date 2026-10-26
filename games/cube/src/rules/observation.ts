import { snapshotJson, type DeepReadonly } from "@si-arena/protocol";
import { CUBE_CONFIG, CUBE_FACELETS, CUBE_MAX_TICKS, CUBE_SCORE_BASE } from "../constants";
import type { CubeEvent, CubeObservation, CubeState } from "../sdk";
import { isCubeMove } from "./moves";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** A solo run ends when the cube is solved or the tick budget runs out. */
export function cubeFinished(state: DeepReadonly<CubeState>): boolean {
  return state.solved || state.tick >= state.maxTicks;
}

/** One tick yields at most the turn and, on the last one, the solve. */
const MAX_EVENTS = 2;

function readEvents(raw: unknown, ids: readonly string[]): CubeEvent[] {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) throw new TypeError("Invalid cube events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!ids.includes(id)) throw new TypeError("Unknown event player");
    return id;
  };
  return raw.map((item): CubeEvent => {
    if (item === null || typeof item !== "object") throw new TypeError("Invalid event");
    const type = Object.getOwnPropertyDescriptor(item, "type")?.value;
    if (type === "turn") {
      const event = readRecord(item, ["type", "playerId", "move", "moves"], "turn event");
      if (!isCubeMove(event.move)) throw new TypeError("Invalid turn event move");
      return {
        type,
        playerId: playerId(event.playerId),
        move: event.move,
        moves: readInteger(event.moves, 1, CUBE_MAX_TICKS, "event moves"),
      };
    }
    if (type === "solved") {
      const event = readRecord(item, ["type", "playerId", "moves", "score"], "solved event");
      return {
        type,
        playerId: playerId(event.playerId),
        moves: readInteger(event.moves, 0, CUBE_MAX_TICKS, "event moves"),
        score: readInteger(event.score, 0, CUBE_SCORE_BASE, "event score"),
      };
    }
    throw new TypeError("Unknown cube event type");
  });
}

export function observeCube(
  state: DeepReadonly<CubeState>,
  playerId: string,
  context?: { events: DeepReadonly<CubeEvent[]> },
): CubeObservation | null {
  if (playerId !== state.playerId) return null;
  return {
    tick: state.tick,
    maxTicks: state.maxTicks,
    selfId: playerId,
    facelets: state.facelets.slice(),
    moves: state.moves,
    score: state.score,
    solved: state.solved,
    scrambleLength: CUBE_CONFIG.scramble,
    events: snapshotJson(context?.events ?? []) as CubeEvent[],
  };
}

export function parseCubeObservation(raw: unknown): CubeObservation {
  const value = readRecord(
    raw,
    [
      "tick",
      "maxTicks",
      "selfId",
      "facelets",
      "moves",
      "score",
      "solved",
      "scrambleLength",
      "events",
    ],
    "Cube observation",
  );
  if (value.maxTicks !== CUBE_MAX_TICKS || value.scrambleLength !== CUBE_CONFIG.scramble)
    throw new TypeError("Cube observation must use the published tick limit and scramble");
  if (value.solved !== true && value.solved !== false)
    throw new TypeError("Cube observation solved must be a boolean");
  const selfId = readId(value.selfId);
  return snapshotJson({
    tick: readInteger(value.tick, 0, CUBE_MAX_TICKS, "observation tick"),
    maxTicks: CUBE_MAX_TICKS,
    selfId,
    facelets: readArray(value.facelets, CUBE_FACELETS, "observation facelets").map(
      (facelet: unknown, index: number) => readInteger(facelet, 0, 5, `facelets[${index}]`),
    ),
    moves: readInteger(value.moves, 0, CUBE_MAX_TICKS, "observation moves"),
    score: readInteger(value.score, 0, CUBE_SCORE_BASE, "observation score"),
    solved: value.solved,
    scrambleLength: CUBE_CONFIG.scramble,
    events: readEvents(value.events, [selfId]),
  }) as CubeObservation;
}
