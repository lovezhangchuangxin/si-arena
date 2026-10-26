import { isJsonSnapshot, type DeepReadonly, type InitInput } from "@si-arena/protocol";
import {
  CUBE_CONFIG,
  CUBE_FACELETS,
  CUBE_FACE_STICKERS,
  CUBE_MAX_TICKS,
  CUBE_MOVE_COST,
  CUBE_PLAYERS,
  CUBE_SCORE_BASE,
} from "../constants";
import type { CubeMove, CubeState } from "../sdk";
import { SOLVED_FACELETS, applyMove, isSolved } from "./moves";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** Score for a finished solve; an unsolved run scores nothing. */
export function cubeScore(moves: number): number {
  return Math.max(0, CUBE_SCORE_BASE - CUBE_MOVE_COST * moves);
}

/** One xorshift32 round; the only place the bit-twiddling lives. */
export function xorshift32(state: number): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

export function createRng(seed: number): { next(): number } {
  let current = seed || 0x9e3779b9;
  for (let warmUp = 0; warmUp < 4; warmUp++) current = xorshift32(current);
  return {
    next() {
      current = xorshift32(current);
      return current;
    },
  };
}

/** Face order U R F D L B; U/D turn about y, R/L about x, F/B about z. */
const FACE_AXIS: readonly number[] = [1, 0, 2, 1, 0, 2];
const FACE_LETTERS: readonly string[] = ["U", "R", "F", "D", "L", "B"];

/**
 * A scramble that never undoes itself: the same face cannot repeat, and a face
 * cannot return after its opposite face has just turned.
 */
export function buildScramble(next: () => number): CubeMove[] {
  const moves: CubeMove[] = [];
  let previousFace = -1;
  let faceBeforePrevious = -1;
  for (let attempt = 0; moves.length < CUBE_CONFIG.scramble; attempt++) {
    if (attempt > CUBE_CONFIG.scramble * 64)
      throw new TypeError("Scramble generator failed to advance");
    const face = next() % 6;
    if (face === previousFace) continue;
    if (face === faceBeforePrevious && FACE_AXIS[face] === FACE_AXIS[previousFace]) continue;
    const power = next() % 3;
    const suffix = power === 1 ? "2" : power === 2 ? "'" : "";
    moves.push(`${FACE_LETTERS[face]}${suffix}` as CubeMove);
    faceBeforePrevious = previousFace;
    previousFace = face;
  }
  return moves;
}

export function initCube(input: InitInput): CubeState {
  const players = input.players;
  if (players.length !== CUBE_PLAYERS || players[0]!.slot !== 0)
    throw new TypeError("Cube seats exactly one player at slot 0");
  const rng = createRng(input.seed);
  let facelets = SOLVED_FACELETS.slice();
  for (const move of buildScramble(rng.next)) facelets = applyMove(facelets, move);
  // A scramble that lands back on the solved cube would hand out a free record.
  if (isSolved(facelets)) facelets = applyMove(facelets, "R");
  return {
    tick: 0,
    maxTicks: CUBE_MAX_TICKS,
    facelets,
    moves: 0,
    score: 0,
    solved: false,
    playerId: players[0]!.id,
  };
}

function readFacelets(raw: unknown): number[] {
  const facelets = readArray(raw, CUBE_FACELETS, "facelets").map((facelet, index) =>
    readInteger(facelet, 0, 5, `facelets[${index}]`),
  );
  const counts = [0, 0, 0, 0, 0, 0];
  for (const facelet of facelets) counts[facelet]! += 1;
  if (counts.some((count) => count !== CUBE_FACE_STICKERS))
    throw new TypeError("Cube facelets must use nine stickers per colour");
  // Centres never move, so every face keeps its own colour in the middle.
  for (let face = 0; face < 6; face++)
    if (facelets[face * CUBE_FACE_STICKERS + 4] !== face)
      throw new TypeError("Cube facelets must keep every centre on its own face");
  return facelets;
}

/** parseCubeState for read-only use: engine snapshots are shared, not copied. */
const validatedStates = new WeakMap<object, DeepReadonly<CubeState>>();

export function viewCubeState(raw: unknown): DeepReadonly<CubeState> {
  const known = raw !== null && typeof raw === "object" && isJsonSnapshot(raw);
  if (known) {
    const cached = validatedStates.get(raw as object);
    if (cached) return cached;
  }
  const result = readCubeState(raw);
  if (known) {
    const frozen = raw as DeepReadonly<CubeState>;
    validatedStates.set(raw as object, frozen);
    return frozen;
  }
  return result;
}

export function parseCubeState(raw: unknown): CubeState {
  return readCubeState(raw);
}

function readCubeState(raw: unknown): CubeState {
  const value = readRecord(
    raw,
    ["tick", "maxTicks", "facelets", "moves", "score", "solved", "playerId"],
    "Cube state",
  );
  if (value.maxTicks !== CUBE_MAX_TICKS)
    throw new TypeError("Cube state must use the published tick limit");
  if (value.solved !== true && value.solved !== false)
    throw new TypeError("Cube state solved must be a boolean");
  const state: CubeState = {
    tick: readInteger(value.tick, 0, CUBE_MAX_TICKS, "tick"),
    maxTicks: CUBE_MAX_TICKS,
    facelets: readFacelets(value.facelets),
    moves: readInteger(value.moves, 0, CUBE_MAX_TICKS, "moves"),
    score: readInteger(value.score, 0, CUBE_SCORE_BASE, "score"),
    solved: value.solved,
    playerId: readId(value.playerId),
  };
  if (state.moves > state.tick)
    throw new TypeError("Cube state cannot hold more moves than completed ticks");
  if (state.solved !== isSolved(state.facelets))
    throw new TypeError("Cube state solved flag must follow the facelets");
  if (state.score !== (state.solved ? cubeScore(state.moves) : 0))
    throw new TypeError("Cube state score must follow the move count");
  return state;
}
