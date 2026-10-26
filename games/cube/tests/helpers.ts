import { cubeManifest } from "@si-arena/game-cube";
import type { CubeAction, CubeMove, CubeState } from "@si-arena/game-cube/sdk";
import { cubeRules, applyMove } from "@si-arena/game-cube/rules";

export const ID = "alpha";

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}

export const idle: CubeAction = { type: "idle" };
export const turn = (move: CubeMove): CubeAction => ({ type: "move", move });

export function init(seed = 2): CubeState {
  return cubeRules.init({
    seed,
    config: { ...cubeManifest.config },
    players: [{ id: ID, slot: 0 }],
  });
}

export function step(state: CubeState, action: CubeAction = idle) {
  return cubeRules.step(state, { [ID]: action });
}

/** Runs a list of moves one tick at a time, returning the last step. */
export function play(state: CubeState, moves: readonly CubeMove[]) {
  let current = state;
  let last = step(current, idle);
  for (const move of moves) {
    last = step(current, turn(move));
    current = last.nextState;
  }
  return { state: current, last };
}

/** The inverse of a move, so a scramble can be undone move by move. */
export function invert(move: CubeMove): CubeMove {
  if (move.endsWith("2")) return move;
  return (move.endsWith("'") ? move[0] : `${move}'`) as CubeMove;
}

export const faceletsAfter = (moves: readonly CubeMove[], from: readonly number[]): number[] => {
  let facelets = [...from];
  for (const move of moves) facelets = applyMove(facelets, move);
  return facelets;
};

export const solvedStickers = (facelets: readonly number[]): number =>
  facelets.reduce(
    (total, facelet, index) => total + (facelet === Math.floor(index / 9) ? 1 : 0),
    0,
  );
