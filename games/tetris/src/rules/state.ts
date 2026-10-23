import { isJsonSnapshot, type DeepReadonly, type InitInput } from "@si-arena/protocol";
import {
  TETRIS_CONFIG,
  TETRIS_LINES_PER_LEVEL,
  TETRIS_MAX_TICKS,
  TETRIS_PLAYERS,
} from "../constants";
import type { TetrisPiece, TetrisPieceType, TetrisState } from "../sdk";
import { readArray, readId, readInteger, readRange, readRecord } from "./validation";

/** The seven tetrominoes in bag order; type index 1–7. */
export const PIECE_TYPES: readonly TetrisPieceType[] = [1, 2, 3, 4, 5, 6, 7];
/** Spawn cells of each type at rotation 0, as offsets from the piece origin. */
const SPAWN_SHAPES: Readonly<Record<TetrisPieceType, readonly [number, number][]>> = {
  1: [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ], // I
  2: [
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 1],
  ], // O
  3: [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ], // T
  4: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ], // S
  5: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ], // Z
  6: [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ], // J
  7: [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ], // L
};
/** The rotation box side per type: 4 for I, 2 for O, 3 for the rest. */
const BOX: Readonly<Record<TetrisPieceType, number>> = { 1: 4, 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3 };

function rotateShape(cells: readonly [number, number][], box: number): [number, number][] {
  // A quarter turn inside the box: (dx, dy) -> (box - 1 - dy, dx).
  return cells.map(([dx, dy]) => [box - 1 - dy, dx] as [number, number]);
}

/** Cell offsets of a type at a rotation, in publish order. */
export const SHAPES: Readonly<Record<TetrisPieceType, readonly (readonly [number, number][])[]>> =
  Object.fromEntries(
    PIECE_TYPES.map((type) => {
      const rotations: [number, number][][] = [SPAWN_SHAPES[type]!.slice() as [number, number][]];
      for (let step = 1; step < 4; step++)
        rotations.push(rotateShape(rotations[step - 1]!, BOX[type]!));
      return [type, Object.freeze(rotations.map((cells) => Object.freeze(cells)))];
    }),
  );

/** Horizontal kick offsets tried, in order, when a rotation must be nudged. */
export const KICKS: readonly number[] = [0, -1, 1, -2, 2];
/** The spawn origin: column 3 keeps every piece centred, row 0 fully visible. */
export const SPAWN_X = 3;

export function pieceCells(piece: TetrisPiece): Array<[number, number]> {
  return SHAPES[piece.type]![piece.rotation % 4]!.map(
    ([dx, dy]) => [piece.x + dx, piece.y + dy] as [number, number],
  );
}

export interface Board {
  width: number;
  height: number;
  cells: readonly number[];
}

/** Whether every cell of the piece at this origin is inside the board and free. */
export function fits(board: Board, piece: TetrisPiece): boolean {
  return pieceCells(piece).every(
    ([x, y]) =>
      x >= 0 &&
      x < board.width &&
      y >= 0 &&
      y < board.height &&
      board.cells[y * board.width + x] === 0,
  );
}

export function fallInterval(level: number): number {
  const interval = TETRIS_CONFIG.fallBase - (level - 1);
  return Math.max(TETRIS_CONFIG.fallMin, interval);
}

export function levelOf(lines: number): number {
  return 1 + Math.floor(lines / TETRIS_LINES_PER_LEVEL);
}

function shuffledBag(next: () => number): TetrisPieceType[] {
  const bag = PIECE_TYPES.slice();
  for (let index = bag.length - 1; index > 0; index--) {
    const other = next() % (index + 1);
    [bag[index], bag[other]] = [bag[other]!, bag[index]!];
  }
  return bag;
}

/** One xorshift32 round; the only place the bit-twiddling lives. */
export function xorshift32(state: number): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

/**
 * xorshift32 stream; the exposed state is live, so a snapshot taken after
 * consuming draws reflects every `next()` call made so far.
 */
export function createRng(seed: number): { state: number; next(): number } {
  let current = seed || 0x9e3779b9;
  const next = () => {
    current = xorshift32(current);
    return current;
  };
  for (let warmUp = 0; warmUp < 4; warmUp++) next();
  return {
    next,
    get state() {
      return current;
    },
  };
}

export function initTetris(input: InitInput): TetrisState {
  const players = input.players;
  if (players.length !== TETRIS_PLAYERS || players[0]!.slot !== 0)
    throw new TypeError("Tetris seats exactly one player at slot 0");
  const rng = createRng(input.seed);
  const queue = shuffledBag(rng.next);
  const piece: TetrisPiece = { type: queue.shift()!, rotation: 0, x: SPAWN_X, y: 0 };
  const state: TetrisState = {
    tick: 0,
    maxTicks: TETRIS_MAX_TICKS,
    width: TETRIS_CONFIG.width,
    height: TETRIS_CONFIG.height,
    cells: Array.from<number>({ length: TETRIS_CONFIG.width * TETRIS_CONFIG.height }).fill(0),
    piece,
    queue,
    rngState: rng.state,
    lines: 0,
    score: 0,
    level: 1,
    fallCounter: 0,
    over: false,
    playerId: players[0]!.id,
  };
  if (!fits(state, piece)) state.over = true;
  return state;
}

function readPiece(raw: unknown, width: number, height: number, label: string): TetrisPiece {
  const value = readRecord(raw, ["type", "rotation", "x", "y"], label);
  const piece: TetrisPiece = {
    type: readInteger(value.type, 1, PIECE_TYPES.length, `${label}.type`),
    rotation: readInteger(value.rotation, 0, 3, `${label}.rotation`),
    x: readInteger(value.x, -3, width - 1, `${label}.x`),
    y: readInteger(value.y, 0, height - 1, `${label}.y`),
  };
  return piece;
}

export function parseTetrisState(raw: unknown): TetrisState {
  return viewTetrisState(raw) as TetrisState;
}

/** parseTetrisState for read-only use: engine snapshots are shared, not copied. */
const validatedStates = new WeakMap<object, DeepReadonly<TetrisState>>();

export function viewTetrisState(raw: unknown): DeepReadonly<TetrisState> {
  const known = raw !== null && typeof raw === "object" && isJsonSnapshot(raw);
  if (known) {
    const cached = validatedStates.get(raw as object);
    if (cached) return cached;
  }
  const result = readTetrisState(raw);
  if (known) {
    const frozen = raw as DeepReadonly<TetrisState>;
    validatedStates.set(raw as object, frozen);
    return frozen;
  }
  return result;
}

function readTetrisState(raw: unknown): TetrisState {
  const value = readRecord(
    raw,
    [
      "tick",
      "maxTicks",
      "width",
      "height",
      "cells",
      "piece",
      "queue",
      "rngState",
      "lines",
      "score",
      "level",
      "fallCounter",
      "over",
      "playerId",
    ],
    "Tetris state",
  );
  const { width, height } = TETRIS_CONFIG;
  if (value.width !== width || value.height !== height || value.maxTicks !== TETRIS_MAX_TICKS)
    throw new TypeError("Tetris state must use the published board size and tick limit");
  const state: TetrisState = {
    tick: readInteger(value.tick, 0, TETRIS_MAX_TICKS, "tick"),
    maxTicks: TETRIS_MAX_TICKS,
    width,
    height,
    cells: readArray(value.cells, width * height, "cells").map((cell, index) =>
      readInteger(cell, 0, PIECE_TYPES.length, `cells[${index}]`),
    ),
    piece: readPiece(value.piece, width, height, "piece"),
    queue: readRange(value.queue, 1, 14, "queue").map((type: unknown, index: number) =>
      readInteger(type, 1, PIECE_TYPES.length, `queue[${index}]`),
    ),
    rngState: readInteger(value.rngState, 1, 0xffffffff, "rngState"),
    lines: readInteger(value.lines, 0, Number.MAX_SAFE_INTEGER, "lines"),
    score: readInteger(value.score, 0, Number.MAX_SAFE_INTEGER, "score"),
    level: readInteger(value.level, 1, levelOf(Number.MAX_SAFE_INTEGER), "level"),
    fallCounter: readInteger(value.fallCounter, 0, 0xffffffff, "fallCounter"),
    over: value.over === true,
    playerId: readId(value.playerId),
  };
  if (value.over !== false && value.over !== true)
    throw new TypeError("Tetris state over must be a boolean");
  if (state.level !== levelOf(state.lines))
    throw new TypeError("Tetris state level must follow the cleared lines");
  if (state.fallCounter >= fallInterval(state.level) && !state.over && state.tick > 0)
    throw new TypeError("Tetris state fallCounter must stay below the level interval");
  // Once over, the piece field freezes at its last live position: its cells
  // may already be merged into the board, so only live worlds must fit.
  if (!state.over && !fits(state, state.piece))
    throw new TypeError("Tetris state piece must rest on free cells");
  if (state.queue.length < 1) throw new TypeError("Tetris state queue must hold the next piece");
  return state;
}
