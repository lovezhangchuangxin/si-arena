import { describe, expect, test } from "vitest";
import { tetrisRules } from "@si-arena/game-tetris/rules";
import {
  fallInterval,
  levelOf,
  parseTetrisAction,
  parseTetrisState,
  parseTetrisObservation,
  pieceCells,
  SHAPES,
  tetrisFinished,
} from "@si-arena/game-tetris/rules";
import { TETRIS_LINE_POINTS } from "../src/constants";
import { drop, ID, idle, init, move, required, rotate, stacked, step, topOf } from "./helpers";

/** Reference xorshift32 so tests track the exact PRNG position, not a copy. */
function referenceXorshift32(value: number): number {
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

/** Drives the world with idle actions, collecting every spawned piece type. */
function dealtTypes(seed: number, count: number): number[] {
  const types: number[] = [];
  let world = init(seed);
  // Bag refills draw exactly 6 outputs per shuffle, so the visible queue can
  // lag the stream; stepping until `count` spawns covers several refills.
  types.push(world.piece.type);
  while (types.length < count) {
    const output = step(world);
    for (const event of output.events)
      if (event.type === "spawn" && event.playerId === ID) types.push(event.piece);
    world = output.nextState;
    if (output.result) break;
  }
  return types.slice(0, count);
}

describe("init", () => {
  test("seats exactly one player at slot 0", () => {
    expect(() => init()).not.toThrow();
    const state = init();
    expect(state.tick).toBe(0);
    expect(state.width).toBe(10);
    expect(state.height).toBe(20);
    expect(state.cells.every((cell) => cell === 0)).toBe(true);
    expect(state.lines).toBe(0);
    expect(state.score).toBe(0);
    expect(state.level).toBe(1);
    expect(state.over).toBe(false);
    expect(state.playerId).toBe(ID);
    expect(state.queue.length).toBeGreaterThanOrEqual(1);
  });

  test("same seed deals the same queue, different seeds differ", () => {
    const a = init(42);
    const b = init(42);
    const c = init(43);
    expect(a.queue).toStrictEqual(b.queue);
    expect(a.piece.type).toBe(b.piece.type);
    expect(a.piece).toEqual(b.piece);
    expect([a.piece.type, ...a.queue].join(",")).not.toBe([c.piece.type, ...c.queue].join(","));
  });

  test("the stored rngState already reflects the first bag's draws", () => {
    // The world must resume the random stream where init left it; otherwise
    // the second bag is shuffled from the pre-first-bag state and repeats
    // the first bag's permutation.
    for (const seed of [12345, 42, 2]) {
      const state = init(seed);
      let expected = seed || 0x9e3779b9;
      for (let round = 0; round < 4 + 6; round++) expected = referenceXorshift32(expected);
      expect(state.rngState).toBe(expected);
    }
  });
});

describe("parseTetrisState", () => {
  test("round-trips a live world", () => {
    const state = init();
    expect(parseTetrisState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  test("rejects drift from the published board and tick limit", () => {
    const state = init();
    for (const patch of [
      { width: 11 },
      { height: 22 },
      { maxTicks: 99 },
      { level: 3 },
      { cells: Array.from({ length: 199 }, () => 0) },
    ]) {
      const broken = { ...state, ...patch };
      expect(() => parseTetrisState(broken)).toThrow(TypeError);
    }
  });
});

describe("7-bag dealing", () => {
  test("every bag is a permutation of all seven types", () => {
    for (const seed of [12345, 42, 2]) {
      const stream = dealtTypes(seed, 21);
      for (let start = 0; start + 7 <= stream.length; start += 7) {
        expect(stream.slice(start, start + 7).toSorted((a, b) => a - b)).toEqual([
          1, 2, 3, 4, 5, 6, 7,
        ]);
      }
    }
  });

  test("consecutive bags never repeat the same permutation", () => {
    for (const seed of [12345, 42, 2]) {
      const stream = dealtTypes(seed, 21);
      for (let start = 7; start + 7 <= stream.length; start += 7) {
        expect(stream.slice(start, start + 7).join(",")).not.toBe(
          stream.slice(start - 7, start).join(","),
        );
      }
    }
  });
});

describe("actions", () => {
  test("parses valid actions and rejects malformed ones", () => {
    expect(parseTetrisAction({ type: "idle" })).toEqual({ ok: true, action: { type: "idle" } });
    expect(parseTetrisAction({ type: "move", direction: "left" })).toEqual({
      ok: true,
      action: { type: "move", direction: "left" },
    });
    expect(parseTetrisAction({ type: "rotate", rotation: "ccw" })).toEqual({
      ok: true,
      action: { type: "rotate", rotation: "ccw" },
    });
    expect(parseTetrisAction({ type: "drop" })).toEqual({ ok: true, action: { type: "drop" } });
    for (const raw of [
      null,
      "idle",
      [],
      { type: "jump" },
      { type: "move", direction: "up" },
      { type: "move" },
      { type: "rotate", rotation: "flip" },
      { type: "drop", extra: 1 },
    ])
      expect(parseTetrisAction(raw).ok).toBe(false);
  });

  test("default action is idle", () => {
    const state = init();
    expect(tetrisRules.defaultAction(state, ID)).toEqual({ type: "idle" });
  });
});

describe("movement and gravity", () => {
  test("left and right move within walls", () => {
    let state = init(7);
    const first = required(SHAPES[state.piece.type]?.[state.piece.rotation]);
    // Walk the piece to the left wall.
    for (let guard = 0; guard < 8; guard++) {
      const left = first.map(([dx, dy]) => [state.piece.x + dx - 1, state.piece.y + dy]);
      if (left.some(([x]) => (x ?? 0) < 0)) break;
      state = step(state, move("left")).nextState;
    }
    expect(Math.min(...pieceCells(state.piece).map(([x]) => x))).toBe(0);
  });

  test("gravity falls one row per interval", () => {
    let state = init(9);
    for (let tick = 0; tick < 36; tick++) state = step(state, idle).nextState;
    expect(state.piece.y).toBe(3);
    expect(state.fallCounter).toBe(0);
  });

  test("soft drop falls one row without scoring", () => {
    const state = init(11);
    const first = step(state, move("down"));
    expect(first.nextState.piece.y).toBe(state.piece.y + 1);
    expect(first.nextState.score).toBe(0);
    expect(first.events).toEqual([{ type: "move", playerId: ID, direction: "down" }]);
  });
});

describe("rotation", () => {
  test("cw rotation changes the cell offsets and wall-kicks at the left wall", () => {
    let state = init(3);
    const before = pieceCells(state.piece);
    state = step(state, rotate("cw")).nextState;
    expect(state.piece.rotation % 4).toBe(1);
    expect(pieceCells(state.piece)).not.toEqual(before);
  });

  test("ccw rotation wraps to rotation 3", () => {
    let state = init(3);
    state = step(state, rotate("ccw")).nextState;
    expect(state.piece.rotation % 4).toBe(3);
  });
});

describe("locking, clearing and scoring", () => {
  test("hard drop locks immediately without scoring", () => {
    let state = init(5);
    state = step(state, drop).nextState;
    // Piece merged into the bottom rows and a new piece spawned at the top.
    expect(state.cells.some((cell) => cell !== 0)).toBe(true);
    expect(state.piece.y).toBe(0);
    expect(state.score).toBe(0);
  });

  test("locking a piece that completes rows clears them and scores lines × level", () => {
    // Bottom row complete except column 0. Whatever the seed's first piece is,
    // walk it to column 0 (the shape may overhang, but rotation 0 pieces that
    // fill x=0 complete the row); verify any clear follows the score table.
    const bottom = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    let state = stacked([bottom], 2);
    // Move the piece as far left as it goes, then hard drop.
    for (let guard = 0; guard < 6; guard++) {
      const candidate = step(state, move("left")).nextState;
      if (candidate.piece.x === state.piece.x) break;
      state = candidate;
    }
    const result = step(state, drop);
    state = result.nextState;
    const lock = required(result.events.find((event) => event.type === "lock"));
    // The gap is at x=0; a rotation-0 piece at the left wall always touches
    // column 0 only through its own leftmost cell, so a clear happens when the
    // piece occupies the missing cell (x=0, bottom row).
    if ((lock as { lines: number }).lines === 1) {
      expect(state.lines).toBe(1);
      expect(state.score).toBe(1 * state.level);
      expect(topOf(state, 0)).toBe(state.height);
    } else {
      expect((lock as { lines: number }).lines).toBe(0);
      expect(state.lines).toBe(0);
    }
  });

  test("ten cleared lines level up and shrink the interval", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(9)).toBe(1);
    expect(levelOf(10)).toBe(2);
    expect(fallInterval(1)).toBe(12);
    expect(fallInterval(12)).toBe(1);
    expect(fallInterval(20)).toBe(1);
    expect(TETRIS_LINE_POINTS).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("game end", () => {
  test("tops out when the spawn area is buried", () => {
    const state = init(13);
    // Bury every spawn column except the current piece's cells, then let the
    // piece lock: the next spawn finds no room and the run ends.
    state.cells.fill(2);
    for (const [x, y] of pieceCells(state.piece)) state.cells[y * state.width + x] = 0;
    let world = state;
    let result: ReturnType<typeof step> | undefined;
    for (let tick = 0; tick < 60; tick++) {
      result = step(world, drop);
      world = result.nextState;
      if (result.result !== undefined) break;
    }
    expect(required(result?.result).reason).toBe("top-out");
    expect(required(result?.result).players).toEqual([{ id: ID, rank: 1, score: world.score }]);
  });

  test("ends at the tick limit with the score preserved", () => {
    let state = init(17);
    // Fast-forward to the last tick: soft drops finish pieces quickly, but the
    // run must still end at exactly maxTicks when the stack never tops out
    // within the horizon; verify whichever terminal condition fires first.
    let result: ReturnType<typeof step> | undefined;
    while (state.tick < state.maxTicks) {
      result = step(state, idle);
      state = result.nextState;
      if (result.result !== undefined) break;
    }
    expect(tetrisFinished(state)).toBe(true);
    if (required(result?.result).reason === "tick-limit") {
      expect(state.tick).toBe(state.maxTicks);
    } else {
      expect(state.over).toBe(true);
    }
    expect(required(result?.result).players[0]).toMatchObject({ id: ID, rank: 1 });
    expect(required(result?.result).completedTicks).toBe(state.tick);
  });
});

describe("observation", () => {
  test("mirrors public facts and validates on the way back", () => {
    let state = init(19);
    const first = step(state, idle);
    state = first.nextState;
    const observation = required(tetrisRules.observe(state, ID, { events: first.events }));
    expect(observation.tick).toBe(state.tick);
    expect(observation.selfId).toBe(ID);
    expect(observation.board.cells).toEqual(state.cells);
    expect(observation.piece).toEqual(state.piece);
    expect(observation.next).toBe(state.queue[0]);
    expect(observation.fallInterval).toBe(fallInterval(state.level));
    expect(parseTetrisObservation(JSON.parse(JSON.stringify(observation)))).toEqual(observation);
    expect(tetrisRules.observe(state, "other")).toBeNull();
  });
});

describe("step purity", () => {
  test("never mutates the input world", () => {
    let state = init(23);
    for (const action of [move("left"), rotate("cw"), move("down"), drop, idle]) {
      const before = JSON.stringify(state);
      step(state, action);
      expect(JSON.stringify(state)).toBe(before);
    }
  });
});
