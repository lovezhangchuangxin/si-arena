import { expect, test } from "vitest";
import {
  BOMBER_PALETTE,
  drawBomberBoard,
  bomberPlayerSummaries,
  bomberPresentation,
  bomberHighlights,
} from "@si-arena/game-bomber/renderer";
import { bomberGame } from "@si-arena/game-bomber/game";
import type { BomberEvent, BomberState } from "@si-arena/game-bomber/sdk";
import { collapseTo, eliminate, init, placeBomb, powerup, wall, world } from "./helpers";

interface Call {
  op: string;
  args: Array<number | string>;
  fillStyle: string;
  strokeStyle: string;
}

/** Records draw calls with the style at call time; no real canvas needed. */
function draw(state: BomberState, events: BomberEvent[] = [], erroredPlayers: string[] = []) {
  const calls: Call[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    createLinearGradient() {
      return { addColorStop() {} } as CanvasGradient;
    },
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    fill() {},
    stroke() {
      record("stroke", []);
    },
    arc(...args: number[]) {
      record("arc", args);
    },
    fillRect(...args: number[]) {
      record("fillRect", args);
    },
    strokeRect(...args: number[]) {
      record("strokeRect", args);
    },
    fillText(text: string, x: number, y: number) {
      record("fillText", [text, x, y]);
    },
  };
  function record(op: string, args: Array<number | string>) {
    calls.push({ op, args, fillStyle: context.fillStyle, strokeStyle: context.strokeStyle });
  }
  drawBomberBoard(context as unknown as CanvasRenderingContext2D, state, 300, 260, {
    previousState: init(4),
    events,
    progress: 0.5,
    reducedMotion: false,
    erroredPlayers: new Set(erroredPlayers),
  });
  return calls;
}

test("the ground, pillars, walls and collapsed cells are drawn from the world", () => {
  const state = collapseTo(
    wall(
      world([
        [2, 2],
        [12, 10],
      ]),
      [3, 2],
    ),
    300,
  );
  const calls = draw(state);
  expect(calls[0]).toMatchObject({
    op: "fillRect",
    args: [0, 0, 300, 260],
    fillStyle: BOMBER_PALETTE.ground,
  });
  const pillar = calls.find((call) => call.fillStyle === BOMBER_PALETTE.pillar);
  expect(pillar).toMatchObject({ op: "fillRect", args: [20, 20, 20, 20] });
  expect(
    calls.some(
      (call) => call.fillStyle === BOMBER_PALETTE.wall && call.args.join() === "60,40,20,20",
    ),
  ).toBe(true);
  expect(calls.some((call) => call.fillStyle === BOMBER_PALETTE.wallInset)).toBe(true);
  expect(
    calls.filter((call) => call.op === "fillRect" && call.fillStyle === BOMBER_PALETTE.collapsed),
  ).toHaveLength(52);
});

test("players, bombs, powerups and summaries use the palette", () => {
  const state = eliminate(init(4), 3);
  placeBomb(state, 0, [2, 0], 3, 2);
  powerup(state, [0, 2], "fire");
  powerup(state, [2, 12], "bomb");
  const calls = draw(state);
  const numbers = calls.filter(
    (call) => call.op === "fillText" && /^[0-9]$/.test(String(call.args[0])),
  );
  expect(numbers.map((call) => call.args[0])).toStrictEqual(["1", "2", "3"]);
  for (const slot of [0, 1, 2]) {
    const { x, y } = state.players[slot]!.position!;
    expect(
      calls.some(
        (call) =>
          call.op === "arc" &&
          call.fillStyle === BOMBER_PALETTE.players[slot] &&
          call.args[0] === x * 20 + 10 &&
          call.args[1] === y * 20 + 10,
      ),
    ).toBe(true);
  }
  expect(calls.some((call) => call.op === "arc" && call.fillStyle === BOMBER_PALETTE.bomb)).toBe(
    true,
  );
  expect(
    calls.some((call) => call.op === "arc" && call.strokeStyle === BOMBER_PALETTE.fuseRing),
  ).toBe(true);
  expect(calls.filter((call) => call.op === "fillText" && call.args[0] === "F")).toHaveLength(1);
  expect(
    calls.some(
      (call) =>
        call.op === "fillText" &&
        call.args[0] === "B" &&
        call.fillStyle === BOMBER_PALETTE.powerupInk,
    ),
  ).toBe(true);
  expect(bomberPlayerSummaries(state)).toStrictEqual(
    state.players.map((player, slot) => ({
      id: player.id,
      label: `P${slot + 1}`,
      color: BOMBER_PALETTE.players[slot],
      score: 0,
      alive: slot !== 3,
    })),
  );
});

test("flames of the current tick, a death mark and an errored dead player's badge are drawn", () => {
  const state = eliminate(init(4), 3);
  const fallen = init(4).players[3]!.position!;
  const calls = draw(
    state,
    [
      {
        type: "explosion",
        bombs: [{ position: { x: 2, y: 0 }, ownerId: "alpha" }],
        cells: [0, 1, 2, 3, 4],
        destroyed: [],
      },
      {
        type: "death",
        playerId: "delta",
        position: fallen,
        causes: ["flame"],
        killerIds: ["alpha"],
      },
    ],
    ["delta"],
  );
  expect(
    calls.filter((call) => call.op === "fillRect" && call.fillStyle === BOMBER_PALETTE.flame),
  ).toHaveLength(5);
  expect(
    calls.some((call) => call.op === "stroke" && call.strokeStyle === BOMBER_PALETTE.players[3]),
  ).toBe(true);
  const badge = calls.find((call) => call.op === "fillText" && call.args[0] === "!");
  expect(badge).toBeDefined();
  expect(calls.some((call) => call.op === "arc" && call.fillStyle === BOMBER_PALETTE.warning)).toBe(
    true,
  );
});

test("the presentation describes the published release", () => {
  expect(bomberPresentation.id).toBe(bomberGame.manifest.id);
  expect(bomberPresentation.getStats(bomberGame.manifest)).toStrictEqual([
    { label: "参赛人数", value: "2–4" },
    { label: "地图尺寸", value: "15×13" },
    { label: "回合上限", value: "400" },
    { label: "每 tick CPU", value: "20 ms" },
  ]);
});

test("highlights name wall-breaking explosions, pickups, collapses and eliminations with killers", () => {
  const names = new Map([
    ["a", "Alpha"],
    ["b", "Beta"],
  ]);
  const at = { x: 1, y: 1 };
  expect(
    bomberHighlights(
      [
        { type: "move", playerId: "a", from: at, to: at },
        { type: "bomb-placed", playerId: "a", position: at },
        { type: "explosion", bombs: [{ position: at, ownerId: "a" }], cells: [16], destroyed: [] },
        {
          type: "explosion",
          bombs: [
            { position: at, ownerId: "a" },
            { position: at, ownerId: "b" },
          ],
          cells: [16, 17],
          destroyed: [17, 18],
        },
        { type: "pickup", playerId: "b", kind: "fire", position: at },
        { type: "collapse", ring: 2, cells: [32] },
        { type: "death", playerId: "b", position: at, causes: ["flame"], killerIds: ["a", "c"] },
        {
          type: "death",
          playerId: "c",
          position: at,
          causes: ["flame", "collapse"],
          killerIds: [],
        },
      ],
      names,
    ),
  ).toStrictEqual([
    { text: "Alpha、Beta 的炸弹炸开 2 面软墙", tone: "neutral" },
    { text: "Beta 拾取火焰道具", tone: "neutral" },
    { text: "第 2 圈坍塌", tone: "neutral" },
    { text: "Beta 出局：被火焰波及，击杀者 Alpha、c", tone: "danger" },
    { text: "c 出局：被火焰波及、被坍塌压住", tone: "danger" },
  ]);
});
