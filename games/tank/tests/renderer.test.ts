import { expect, test } from "vitest";
import {
  TANK_PALETTE,
  drawTankBoard,
  tankPlayerSummaries,
  tankPresentation,
  tankHighlights,
} from "@si-arena/game-tank/renderer";
import { tankGame } from "@si-arena/game-tank/game";
import type { TankEvent, TankState } from "@si-arena/game-tank/sdk";
import { bullet, init, world } from "./helpers";

interface Call {
  op: string;
  args: Array<number | string>;
  fillStyle: string;
  strokeStyle: string;
}

/** Records draw calls with the style at call time; no real canvas needed. */
function draw(state: TankState, events: TankEvent[] = [], erroredPlayers: string[] = []) {
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
    fill() {
      record("fill", []);
    },
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
  drawTankBoard(context as unknown as CanvasRenderingContext2D, state, 420, 300, {
    previousState: init(),
    events,
    progress: 0.5,
    reducedMotion: false,
    erroredPlayers: new Set(erroredPlayers),
  });
  return calls;
}

test("the ground, bricks and steel are drawn in their palette colours", () => {
  const state = world(
    [
      [[5, 5], "right"],
      [[15, 9], "left"],
    ],
    { 3: 1, 4: 2 },
  );
  const calls = draw(state);
  expect(calls[0]).toMatchObject({
    op: "fillRect",
    args: [0, 0, 420, 300],
    fillStyle: TANK_PALETTE.ground,
  });
  expect(
    calls.some(
      (call) =>
        call.op === "fillRect" &&
        call.fillStyle === TANK_PALETTE.brick &&
        call.args.join() === "60,0,20,20",
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.op === "fillRect" &&
        call.fillStyle === TANK_PALETTE.steel &&
        call.args.join() === "80,0,20,20",
    ),
  ).toBe(true);
  expect(calls.some((call) => call.fillStyle === TANK_PALETTE.steelLight)).toBe(true);
});

test("tanks get their own colours, a barrel, hp pips, bullets and summaries", () => {
  const state = world([
    [[5, 5], "right"],
    [[15, 9], "up"],
  ]);
  state.tanks[1]!.hp = 1;
  bullet(state, 0, [8, 5], "right");
  const calls = draw(state);
  for (const slot of [0, 1]) {
    const { x, y } = state.tanks[slot]!.position!;
    expect(
      calls.filter(
        (call) =>
          call.op === "fillRect" &&
          call.fillStyle === TANK_PALETTE.players[slot] &&
          Number(call.args[0]) >= x * 20 &&
          Number(call.args[1]) >= y * 20 &&
          Number(call.args[0]) < (x + 1) * 20 &&
          Number(call.args[1]) < (y + 1) * 20,
      ),
    ).toHaveLength(2);
  }
  const barrels = calls.filter(
    (call) => call.op === "fillRect" && call.fillStyle === TANK_PALETTE.barrel,
  );
  expect(barrels).toHaveLength(2);
  // Slot 0 faces right: its barrel starts at the cell centre and extends rightwards.
  expect(barrels[0]!.args[0]).toBe(5 * 20 + 10);
  // Slot 1 faces up: its barrel is vertical and ends at the cell centre.
  expect(barrels[1]!.args[3]).toBe(10);
  expect(
    calls.filter((call) => call.op === "fillRect" && call.fillStyle === TANK_PALETTE.hpPip),
  ).toHaveLength(4);
  expect(
    calls.filter((call) => call.op === "fillRect" && call.fillStyle === TANK_PALETTE.hpLost),
  ).toHaveLength(2);
  const bullets = calls.filter(
    (call) => call.op === "arc" && call.fillStyle === TANK_PALETTE.bullet,
  );
  expect(bullets).toHaveLength(1);
  // Half-way through the tick the bullet is drawn one cell behind its settled position.
  expect(bullets[0]!.args.slice(0, 2)).toStrictEqual([(8 + 0.5 - 1) * 20, 5.5 * 20]);
  expect(tankPlayerSummaries(state)).toStrictEqual([
    { id: "alpha", label: "P1", color: TANK_PALETTE.players[0], score: 3, alive: true },
    { id: "beta", label: "P2", color: TANK_PALETTE.players[1], score: 1, alive: true },
  ]);
});

test("a hit flashes in the attacker's colour, a wreck is marked and an errored dead tank keeps its badge", () => {
  const state = world([
    [[5, 5], "right"],
    [[15, 9], "left"],
  ]);
  state.tick = 1;
  state.tanks[1]!.position = null;
  state.tanks[1]!.hp = 0;
  state.tanks[1]!.death = { tick: 1 };
  const calls = draw(
    state,
    [
      { type: "hit", playerId: "beta", attackerId: "alpha", position: { x: 15, y: 9 }, hp: 0 },
      { type: "death", playerId: "beta", position: { x: 15, y: 9 } },
    ],
    ["beta"],
  );
  expect(
    calls.some((call) => call.op === "arc" && call.strokeStyle === TANK_PALETTE.players[0]),
  ).toBe(true);
  expect(
    calls.some((call) => call.op === "arc" && call.strokeStyle === TANK_PALETTE.players[1]),
  ).toBe(true);
  const badge = calls.find((call) => call.op === "fillText" && call.args[0] === "!");
  expect(badge).toBeDefined();
  expect(calls.some((call) => call.op === "arc" && call.fillStyle === TANK_PALETTE.warning)).toBe(
    true,
  );
  expect(tankPlayerSummaries(state)[1]).toMatchObject({ score: 0, alive: false });
});

test("the presentation describes the published release", () => {
  expect(tankPresentation.id).toBe(tankGame.manifest.id);
  expect(tankPresentation.getStats(tankGame.manifest)).toStrictEqual([
    { label: "参赛人数", value: "2" },
    { label: "地图尺寸", value: "21×15" },
    { label: "回合上限", value: "600" },
    { label: "每 tick CPU", value: "20 ms" },
  ]);
});

test("highlights name hits with the remaining hp, broken bricks and deaths", () => {
  const names = new Map([
    ["a", "Alpha"],
    ["b", "Beta"],
  ]);
  const at = { x: 1, y: 1 };
  expect(
    tankHighlights(
      [
        { type: "move", playerId: "a", from: at, to: at, facing: "up" },
        { type: "fire", playerId: "a", position: at, direction: "up" },
        { type: "hit", playerId: "b", attackerId: "a", position: at, hp: 1 },
        { type: "brick-destroyed", attackerId: "b", cells: [3, 4] },
        { type: "bullets-cancelled", position: at },
        { type: "death", playerId: "c", position: at },
      ],
      names,
    ),
  ).toStrictEqual([
    { text: "Alpha 命中 Beta，剩余 1 点生命", tone: "danger" },
    { text: "Beta 打穿了 2 块砖墙", tone: "neutral" },
    { text: "c 被击毁", tone: "danger" },
  ]);
});
