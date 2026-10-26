import { expect, test } from "vitest";
import {
  CUBE_ASPECT_RATIO,
  CUBE_PALETTE,
  cubeHighlights,
  cubePlayerSummaries,
  cubePresentation,
  cubeScene,
} from "@si-arena/game-cube/renderer";
import { cubeGame } from "@si-arena/game-cube/game";
import { resolveResourceLimits } from "@si-arena/protocol";
import type { CubeEvent } from "@si-arena/game-cube/sdk";
import { ID, init } from "./helpers";

const ERROR_FREE = new Set<string>();

function withEvents(progress: number, reducedMotion = false, ...list: CubeEvent[]) {
  return { events: list, progress, reducedMotion, erroredPlayers: ERROR_FREE };
}

test("the presentation describes the solo run", () => {
  expect(cubePresentation.id).toBe("cube");
  expect(cubePresentation.headline).toContain("单人");
  const stats = cubePresentation.getStats({
    ...cubeGame.manifest,
    resolvedLimits: resolveResourceLimits(),
  });
  expect(stats.map((entry) => entry.value)).toEqual(["1", "22", "400", "20 ms"]);
});

test("summaries expose the single player with the live score", () => {
  const state = init(42);
  const summaries = cubePlayerSummaries(state);
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({ id: state.playerId, label: "P1", alive: true });
  expect(summaries[0]!.score).toBe(state.score);
});

test("the scene describes 26 blocks with their world-facing stickers", () => {
  const state = init(42);
  const scene = cubeScene(state);
  expect(scene.cubies).toHaveLength(26);
  expect(scene.view).toBe("rotateX(-24deg) rotateY(-34deg)");
  expect(CUBE_ASPECT_RATIO).toBeGreaterThan(1);
  // A scrambled world still shows exactly 54 stickers: corners 3, edges 2, centres 1.
  const stickerCount = scene.cubies.reduce(
    (total, cubie) => total + cubie.colours.filter((colour) => colour !== null).length,
    0,
  );
  expect(stickerCount).toBe(54);
});

test("sticker colours follow the world facelets exactly", () => {
  const state = init(42);
  const scene = cubeScene(state);
  for (const cubie of scene.cubies) {
    for (const colour of cubie.colours) {
      if (colour === null) continue;
      expect(CUBE_PALETTE.faces).toContain(colour);
    }
  }
  // The grid centre block of each face carries that face's centre colour.
  const upCentre = scene.cubies.find(
    (cubie) => cubie.pos[0] === 0 && cubie.pos[1] === -1 && cubie.pos[2] === 0,
  );
  expect(upCentre).toBeDefined();
  // Facelet 4 is the U centre and never moves.
  expect(upCentre!.colours[0]).toBe(CUBE_PALETTE.faces[state.facelets[4]!]);
});

test("a turn event spins the whole slab through the short arc", () => {
  const state = init(42);
  const turn: CubeEvent = { type: "turn", playerId: ID, move: "R", moves: state.moves + 1 };
  // The settled frame carries no spin at all.
  const settled = cubeScene(state, withEvents(1, false, turn));
  expect(settled.spin).toBeNull();
  // Halfway through a quarter turn the x = 1 slab sits 45° behind its landing
  // spot: 9 core blocks plus their U F D B neighbours rotate together.
  const moving = cubeScene(state, withEvents(0.5, false, turn));
  expect(moving.spin).toEqual({ axis: "X", angle: -45 });
  expect(moving.cubies.filter((cubie) => cubie.layer)).toHaveLength(9);
  expect(moving.cubies.every((cubie) => cubie.layer === (cubie.pos[0] === 1))).toBe(true);
  // At the window start the slab sits one full turn behind: the previous world.
  expect(cubeScene(state, withEvents(0, false, turn)).spin).toEqual({ axis: "X", angle: -90 });
});

test("half turns spin through 180 degrees and counter turns reverse", () => {
  const state = init(42);
  const half: CubeEvent = { type: "turn", playerId: ID, move: "U2", moves: state.moves + 1 };
  const scene = cubeScene(state, withEvents(0.25, false, half));
  // Three quarters of a 180° turn remain: 135° behind the landing spot.
  expect(scene.spin).toEqual({ axis: "Y", angle: 135 });
  const counter: CubeEvent = { type: "turn", playerId: ID, move: "F'", moves: state.moves + 1 };
  const reversed = cubeScene(state, withEvents(0.5, false, counter));
  expect(reversed.spin).toEqual({ axis: "Z", angle: 45 });
});

test("reduced motion skips the spin but keeps the settled cube", () => {
  const state = init(42);
  const turn: CubeEvent = { type: "turn", playerId: ID, move: "F'", moves: state.moves + 1 };
  const scene = cubeScene(state, withEvents(0.3, true, turn));
  expect(scene.spin).toBeNull();
  expect(scene.panel.last).toBe("F'");
});

test("the panel reports the public figures of the world", () => {
  const state = init(42);
  expect(cubeScene(state).panel).toEqual({
    moves: state.moves,
    score: state.score,
    tick: state.tick,
    maxTicks: state.maxTicks,
    last: "—",
    solved: state.solved,
  });
});

test("highlights narrate turns and the solve", () => {
  const names = new Map([[ID, "选手"]]);
  const solved: CubeEvent = { type: "solved", playerId: ID, moves: 24, score: 1760 };
  const turn: CubeEvent = { type: "turn", playerId: ID, move: "R", moves: 24 };
  expect(cubeHighlights([solved], names)).toEqual([
    { text: "选手 用 24 步还原魔方，得分 1760", tone: "neutral" },
  ]);
  expect(cubeHighlights([turn], names)).toEqual([{ text: "选手 R（第 24 步）", tone: "neutral" }]);
});
