import { expect } from "vitest";
import { tetrisManifest } from "@si-arena/game-tetris";
import type { TetrisAction, TetrisState } from "@si-arena/game-tetris/sdk";
import { tetrisRules } from "@si-arena/game-tetris/rules";

export const ID = "alpha";

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}

export const idle: TetrisAction = { type: "idle" };
export const move = (direction: "left" | "right" | "down"): TetrisAction => ({
  type: "move",
  direction,
});
export const rotate = (rotation: "cw" | "ccw"): TetrisAction => ({ type: "rotate", rotation });
export const drop: TetrisAction = { type: "drop" };

export function init(seed = 2): TetrisState {
  return tetrisRules.init({
    seed,
    config: { ...tetrisManifest.config },
    players: [{ id: ID, slot: 0 }],
  });
}

export function step(state: TetrisState, action: TetrisAction = idle) {
  return tetrisRules.step(state, { [ID]: action });
}

/** Index of the first non-empty row's cell, or -1 on an empty board. */
export function topOf(state: TetrisState, x: number): number {
  for (let y = 0; y < state.height; y++) if (state.cells[y * state.width + x] !== 0) return y;
  return state.height;
}

/** A world with the given rows already locked, bottom-aligned as written. */
export function stacked(rows: readonly (readonly number[])[], seed = 2): TetrisState {
  const state = init(seed);
  state.cells.fill(0);
  const offset = state.height - rows.length;
  rows.forEach((row, index) => {
    row.forEach((cell, x) => {
      state.cells[(offset + index) * state.width + x] = cell;
    });
  });
  // The spawn area must stay clear for the initial piece.
  expect(state.piece).toBeTruthy();
  return state;
}

/** Cell key helper for assertions. */
export const at = (state: TetrisState, x: number, y: number): number =>
  state.cells[y * state.width + x]!;
