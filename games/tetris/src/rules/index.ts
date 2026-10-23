import type { DeepReadonly, GameResult, GameRules } from "@si-arena/protocol";
import { TETRIS_LINE_POINTS } from "../constants";
import type { TetrisAction, TetrisEvent, TetrisObservation, TetrisState } from "../sdk";
import { parseTetrisAction, tetrisDefaultAction } from "./actions";
import { observeTetris, tetrisFinished } from "./observation";
import { fallInterval, fits, initTetris, levelOf, pieceCells, SPAWN_X, xorshift32 } from "./state";

export { parseTetrisAction } from "./actions";
export { parseTetrisState } from "./state";
export { parseTetrisObservation, tetrisFinished } from "./observation";
export { fallInterval, levelOf, pieceCells, SHAPES } from "./state";
export type { TetrisEvent } from "../sdk";

export interface TetrisResult extends GameResult {
  /** `top-out` once a new piece no longer fits, otherwise `tick-limit`. */
  reason: "top-out" | "tick-limit";
  players: Array<{ id: string; rank: number; score: number }>;
}
export interface TetrisStepResult {
  nextState: TetrisState;
  events: TetrisEvent[];
  result?: TetrisResult;
}
export interface TetrisRules extends GameRules<
  TetrisState,
  TetrisObservation,
  TetrisAction,
  TetrisEvent
> {
  step(
    state: DeepReadonly<TetrisState>,
    actions: DeepReadonly<Record<string, TetrisAction>>,
  ): TetrisStepResult;
}

function outcome(state: TetrisState): TetrisResult | undefined {
  if (!tetrisFinished(state)) return undefined;
  return {
    reason: state.over ? "top-out" : "tick-limit",
    completedTicks: state.tick,
    players: [{ id: state.playerId, rank: 1, score: state.score }],
  };
}

/** Clones the world into a private working copy; the input world is never touched. */
function workingCopy(state: DeepReadonly<TetrisState>): TetrisState {
  return {
    tick: state.tick,
    maxTicks: state.maxTicks,
    width: state.width,
    height: state.height,
    cells: state.cells.slice(),
    piece: { ...state.piece },
    queue: state.queue.slice(),
    rngState: state.rngState,
    lines: state.lines,
    score: state.score,
    level: state.level,
    fallCounter: state.fallCounter,
    over: state.over,
    playerId: state.playerId,
  };
}

/** Draws the next type, appending a fresh shuffled bag when the queue runs low. */
function drawFromBag(state: TetrisState): number {
  let rngState = state.rngState;
  const next = () => (rngState = xorshift32(rngState));
  const type = state.queue.shift()!;
  if (state.queue.length < 2) {
    const bag = [1, 2, 3, 4, 5, 6, 7];
    for (let index = bag.length - 1; index > 0; index--) {
      const other = next() % (index + 1);
      [bag[index], bag[other]] = [bag[other]!, bag[index]!];
    }
    state.queue.push(...bag);
  }
  state.rngState = rngState;
  return type;
}

/** Merges the piece, clears full rows and returns which rows were cleared. */
function lockPiece(state: TetrisState): number[] {
  for (const [x, y] of pieceCells(state.piece)) state.cells[y * state.width + x] = state.piece.type;
  const cleared: number[] = [];
  for (let y = state.height - 1; y >= 0; y--) {
    let full = true;
    for (let x = 0; x < state.width; x++)
      if (state.cells[y * state.width + x] === 0) {
        full = false;
        break;
      }
    if (!full) continue;
    state.cells.splice(y * state.width, state.width);
    state.cells.unshift(...Array.from<number>({ length: state.width }).fill(0));
    cleared.push(y);
  }
  return cleared;
}

/** True when the piece rests on something and gravity would lock it. */
function grounded(state: TetrisState): boolean {
  return !fits(state, { ...state.piece, y: state.piece.y + 1 });
}

export const tetrisRules: TetrisRules = {
  init: initTetris,
  observe: observeTetris,
  parseAction: parseTetrisAction,
  defaultAction: tetrisDefaultAction,
  step: tetrisStep,
};

function tetrisStep(
  state: DeepReadonly<TetrisState>,
  actions: DeepReadonly<Record<string, TetrisAction>>,
): TetrisStepResult {
  const world = workingCopy(state);
  const events: TetrisEvent[] = [];
  const player = world.playerId;
  const action: TetrisAction = actions[player] ?? { type: "idle" };

  const rotate = (direction: "cw" | "ccw") => {
    const target =
      direction === "cw" ? (world.piece.rotation + 1) % 4 : (world.piece.rotation + 3) % 4;
    for (const kick of [0, -1, 1, -2, 2]) {
      const candidate = { ...world.piece, rotation: target, x: world.piece.x + kick };
      if (fits(world, candidate)) {
        world.piece = candidate;
        events.push({ type: "rotate", playerId: player, rotation: direction });
        return;
      }
    }
  };

  const lock = () => {
    const rows = lockPiece(world);
    const cleared = rows.length;
    const gain = TETRIS_LINE_POINTS[cleared]! * world.level;
    world.score += gain;
    world.lines += cleared;
    world.fallCounter = 0;
    events.push({
      type: "lock",
      playerId: player,
      piece: world.piece.type,
      lines: cleared,
      rows,
      gain,
    });
    const level = levelOf(world.lines);
    if (level > world.level) {
      world.level = level;
      events.push({ type: "level-up", playerId: player, level });
    }
    const type = drawFromBag(world);
    world.piece = { type, rotation: 0, x: SPAWN_X, y: 0 };
    if (!fits(world, world.piece)) {
      world.over = true;
      events.push({ type: "top-out", playerId: player });
    } else events.push({ type: "spawn", playerId: player, piece: type });
  };

  const fall = () => {
    world.piece = { ...world.piece, y: world.piece.y + 1 };
    world.fallCounter = 0;
  };

  if (!world.over) {
    // 1. The player's action, resolved against the start-of-tick board.
    if (action.type === "move") {
      const dx = action.direction === "left" ? -1 : action.direction === "right" ? 1 : 0;
      if (action.direction === "down") {
        if (!grounded(world)) {
          fall();
          events.push({ type: "move", playerId: player, direction: "down" });
        }
      } else if (fits(world, { ...world.piece, x: world.piece.x + dx })) {
        world.piece = { ...world.piece, x: world.piece.x + dx };
        events.push({ type: "move", playerId: player, direction: action.direction });
      }
    } else if (action.type === "rotate") rotate(action.rotation);
    else if (action.type === "drop") {
      let dropped = 0;
      while (!grounded(world)) {
        world.piece = { ...world.piece, y: world.piece.y + 1 };
        dropped++;
      }
      events.push({ type: "hard-drop", playerId: player, cells: dropped });
      lock();
    }

    // 2. Gravity, unless this tick already spawned a fresh piece.
    if (!world.over && events.every((event) => event.type !== "spawn")) {
      world.fallCounter += 1;
      if (world.fallCounter >= fallInterval(world.level)) {
        if (!grounded(world)) fall();
        else lock();
      }
    }
  }

  world.tick += 1;
  return outcome(world) === undefined
    ? { nextState: world, events }
    : { nextState: world, events, result: outcome(world)! };
}
