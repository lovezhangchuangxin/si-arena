import type { DeepReadonly, GameResult, GameRules } from "@si-arena/protocol";
import type { CubeAction, CubeEvent, CubeObservation, CubeState } from "../sdk";
import { cubeDefaultAction, parseCubeAction } from "./actions";
import { applyMove, isSolved } from "./moves";
import { cubeFinished, observeCube } from "./observation";
import { cubeScore, initCube } from "./state";

export { parseCubeAction } from "./actions";
export { parseCubeObservation, cubeFinished } from "./observation";
export {
  buildScramble,
  createRng,
  cubeScore,
  initCube,
  parseCubeState,
  viewCubeState,
} from "./state";
export {
  CUBE_FACE_ORDER,
  CUBE_MOVES,
  SOLVED_FACELETS,
  applyMove,
  applyTurn,
  isCubeMove,
  isSolved,
  moveFace,
  moveTurns,
} from "./moves";
export type { CubeEvent } from "../sdk";

export interface CubeResult extends GameResult {
  /** `solved` once the cube is restored, otherwise `tick-limit`. */
  reason: "solved" | "tick-limit";
  players: Array<{ id: string; rank: number; score: number }>;
}
export interface CubeStepResult {
  nextState: CubeState;
  events: CubeEvent[];
  result?: CubeResult;
}
export interface CubeRules extends GameRules<CubeState, CubeObservation, CubeAction, CubeEvent> {
  step(
    state: DeepReadonly<CubeState>,
    actions: DeepReadonly<Record<string, CubeAction>>,
  ): CubeStepResult;
}

function outcome(state: CubeState): CubeResult | undefined {
  if (!cubeFinished(state)) return undefined;
  return {
    reason: state.solved ? "solved" : "tick-limit",
    completedTicks: state.tick,
    players: [{ id: state.playerId, rank: 1, score: state.score }],
  };
}

/** Clones the world into a private working copy; the input world is never touched. */
function workingCopy(state: DeepReadonly<CubeState>): CubeState {
  return {
    tick: state.tick,
    maxTicks: state.maxTicks,
    facelets: state.facelets.slice(),
    moves: state.moves,
    score: state.score,
    solved: state.solved,
    playerId: state.playerId,
  };
}

export const cubeRules: CubeRules = {
  init: initCube,
  observe: observeCube,
  parseAction: parseCubeAction,
  defaultAction: cubeDefaultAction,
  step: cubeStep,
};

function cubeStep(
  state: DeepReadonly<CubeState>,
  actions: DeepReadonly<Record<string, CubeAction>>,
): CubeStepResult {
  const world = workingCopy(state);
  const events: CubeEvent[] = [];
  const player = world.playerId;
  const action: CubeAction = actions[player] ?? { type: "idle" };

  // Idle ticks are free: they only burn the tick budget, never a move.
  if (!world.solved && action.type === "move") {
    world.facelets = applyMove(world.facelets, action.move);
    world.moves += 1;
    events.push({ type: "turn", playerId: player, move: action.move, moves: world.moves });
    if (isSolved(world.facelets)) {
      world.solved = true;
      world.score = cubeScore(world.moves);
      events.push({ type: "solved", playerId: player, moves: world.moves, score: world.score });
    }
  }

  world.tick += 1;
  const result = outcome(world);
  return result === undefined ? { nextState: world, events } : { nextState: world, events, result };
}
