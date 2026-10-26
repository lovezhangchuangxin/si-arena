import { expect, test } from "vitest";
import { cubeManifest } from "@si-arena/game-cube";
import {
  CUBE_MOVES,
  SOLVED_FACELETS,
  applyMove,
  applyTurn,
  buildScramble,
  createRng,
  cubeFinished,
  cubeScore,
  isSolved,
  parseCubeAction,
  parseCubeObservation,
  parseCubeState,
} from "@si-arena/game-cube/rules";
import { CUBE_MOVE_COST, CUBE_SCORE_BASE, CUBE_SCORE_ZERO_MOVES } from "../src/constants";
import { ID, faceletsAfter, idle, init, invert, play, step, turn } from "./helpers";

const MAX_TICKS = cubeManifest.maxTicks;

test("the published move set holds eighteen distinct names", () => {
  expect(CUBE_MOVES).toHaveLength(18);
  expect(new Set(CUBE_MOVES).size).toBe(18);
  expect(CUBE_MOVES).toContain("U");
  expect(CUBE_MOVES).toContain("B2");
  expect(CUBE_MOVES).toContain("L'");
});

test("quarter turns have order four and inverse moves cancel", () => {
  for (let face = 0; face < 6; face++) {
    let facelets = [...SOLVED_FACELETS];
    for (let quarter = 0; quarter < 4; quarter++) facelets = applyTurn(facelets, face);
    expect(isSolved(facelets)).toBe(true);
    expect(isSolved(applyTurn([...SOLVED_FACELETS], face))).toBe(false);
  }
  for (const move of CUBE_MOVES) {
    const once = applyMove(SOLVED_FACELETS, move);
    expect(isSolved(applyMove(once, invert(move)))).toBe(true);
  }
});

test("the classic sexy move returns to solved after six repetitions", () => {
  const cycle = ["R", "U", "R'", "U'"] as const;
  let facelets = [...SOLVED_FACELETS];
  for (const move of cycle) facelets = applyMove(facelets, move);
  expect(isSolved(facelets)).toBe(false);
  for (let repeat = 1; repeat < 6; repeat++)
    for (const move of cycle) facelets = applyMove(facelets, move);
  expect(isSolved(facelets)).toBe(true);
});

test("a turn never moves a centre or changes how many stickers each face has", () => {
  for (const move of CUBE_MOVES) {
    const facelets = applyMove(SOLVED_FACELETS, move);
    for (let face = 0; face < 6; face++) expect(facelets[face * 9 + 4]).toBe(face);
    const counts = [0, 0, 0, 0, 0, 0];
    for (const facelet of facelets) counts[facelet]! += 1;
    expect(counts).toEqual([9, 9, 9, 9, 9, 9]);
  }
});

test("the opening scramble is deterministic, unsolved and free of immediate undos", () => {
  const first = init(11);
  const again = init(11);
  expect(first.facelets).toEqual(again.facelets);
  expect(isSolved(first.facelets)).toBe(false);
  expect(first).toMatchObject({ tick: 0, moves: 0, score: 0, solved: false, maxTicks: MAX_TICKS });

  const seeds = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) seeds.add(init(seed).facelets.join(""));
  expect(seeds.size).toBeGreaterThan(10);
});

test("undoing the opening scramble solves the cube inside the tick budget", () => {
  const state = init(7);
  const scramble = buildScramble(createRng(7).next);
  expect(faceletsAfter(scramble, SOLVED_FACELETS)).toEqual(state.facelets);
  expect(scramble).toHaveLength(cubeManifest.config.scramble);

  const inverse = scramble.toReversed().map((move) => invert(move));
  const { last } = play(state, inverse);
  expect(last.result?.reason).toBe("solved");
  expect(last.result?.players[0]).toEqual({
    id: ID,
    rank: 1,
    score: cubeScore(scramble.length),
  });
  expect(last.result?.completedTicks).toBe(scramble.length);
});

test("a move costs one move while an idle tick only burns time", () => {
  const state = init(3);
  const idled = step(state, idle).nextState;
  expect(idled).toMatchObject({ tick: 1, moves: 0, score: 0, solved: false });
  const turned = step(state, turn("R")).nextState;
  expect(turned).toMatchObject({ tick: 1, moves: 1, score: 0 });
  expect(turned.facelets).toEqual(applyMove(state.facelets, "R"));
});

test("solving ends the run immediately and scores the move count", () => {
  const state = parseCubeState({
    tick: 4,
    maxTicks: MAX_TICKS,
    facelets: applyMove(SOLVED_FACELETS, "R"),
    moves: 4,
    score: 0,
    solved: false,
    playerId: ID,
  });
  const output = step(state, turn("R'"));
  expect(output.result).toMatchObject({ reason: "solved", completedTicks: 5 });
  expect(output.result?.players[0]?.score).toBe(CUBE_SCORE_BASE - CUBE_MOVE_COST * 5);
  expect(output.events.map((event) => event.type)).toEqual(["turn", "solved"]);
  expect(cubeFinished(output.nextState)).toBe(true);
});

test("the score never goes below zero and stops paying after the budget", () => {
  expect(cubeScore(0)).toBe(CUBE_SCORE_BASE);
  expect(cubeScore(1)).toBe(CUBE_SCORE_BASE - CUBE_MOVE_COST);
  expect(cubeScore(CUBE_SCORE_ZERO_MOVES)).toBe(0);
  expect(cubeScore(CUBE_SCORE_ZERO_MOVES + 40)).toBe(0);
});

test("running out of ticks ends an unsolved run with no score", () => {
  const state = init(5);
  const almost = parseCubeState({
    ...state,
    tick: MAX_TICKS - 1,
    moves: 0,
  });
  const output = step(almost, idle);
  expect(output.result).toMatchObject({ reason: "tick-limit", completedTicks: MAX_TICKS });
  expect(output.result?.players[0]).toEqual({ id: ID, rank: 1, score: 0 });
});

test("action parsing rejects unknown moves and stray fields", () => {
  expect(parseCubeAction({ type: "idle" })).toEqual({ ok: true, action: { type: "idle" } });
  expect(parseCubeAction({ type: "move", move: "R2" })).toEqual({
    ok: true,
    action: { type: "move", move: "R2" },
  });
  expect(parseCubeAction({ type: "move", move: "X" }).ok).toBe(false);
  expect(parseCubeAction({ type: "move" }).ok).toBe(false);
  expect(parseCubeAction({ type: "move", move: "R", extra: 1 }).ok).toBe(false);
  expect(parseCubeAction({ type: "spin" }).ok).toBe(false);
  expect(parseCubeAction(null).ok).toBe(false);
});

test("state validation keeps the cube and the score honest", () => {
  const base = {
    tick: 2,
    maxTicks: MAX_TICKS,
    facelets: applyMove(SOLVED_FACELETS, "R"),
    moves: 2,
    score: 0,
    solved: false,
    playerId: ID,
  };
  expect(() => parseCubeState(base)).not.toThrow();

  const brokenCount = [...base.facelets];
  brokenCount[0] = 5;
  expect(() => parseCubeState({ ...base, facelets: brokenCount })).toThrow(TypeError);

  const movedCentre = [...base.facelets];
  movedCentre[4] = 1;
  movedCentre[1] = 0;
  expect(() => parseCubeState({ ...base, facelets: movedCentre })).toThrow(TypeError);

  expect(() => parseCubeState({ ...base, solved: true })).toThrow(TypeError);
  expect(() => parseCubeState({ ...base, score: 40 })).toThrow(TypeError);
  expect(() => parseCubeState({ ...base, moves: 5 })).toThrow(TypeError);
  expect(() =>
    parseCubeState({ ...base, facelets: [...SOLVED_FACELETS], solved: true, score: 1980 }),
  ).not.toThrow();
  expect(() => parseCubeState({ ...base, maxTicks: 200 })).toThrow(TypeError);
});

test("observations expose the cube but never the scramble sequence", () => {
  const state = init(9);
  const observation = parseCubeObservation({
    tick: state.tick,
    maxTicks: state.maxTicks,
    selfId: state.playerId,
    facelets: state.facelets,
    moves: state.moves,
    score: state.score,
    solved: state.solved,
    scrambleLength: cubeManifest.config.scramble,
    events: [],
  });
  expect(Object.keys(observation)).toEqual([
    "tick",
    "maxTicks",
    "selfId",
    "facelets",
    "moves",
    "score",
    "solved",
    "scrambleLength",
    "events",
  ]);
  expect(observation.facelets).toEqual(state.facelets);
});
