import { expect, test } from "vitest";
import {
  SNAKE_PALETTE,
  drawSnakeBoard,
  snakePlayerSummaries,
  snakePresentation,
  snakeHighlights,
} from "@si-arena/game-snake/renderer";
import { snakeGame } from "@si-arena/game-snake/game";
import type { SnakeEvent, SnakeState } from "@si-arena/game-snake/sdk";
import { eliminate, init } from "./helpers";

interface Call {
  op: string;
  args: Array<number | string>;
  fillStyle: string;
  strokeStyle: string;
}

/** Records draw calls with the style at call time; no real canvas needed. */
function draw(
  state: SnakeState,
  events: SnakeEvent[] = [],
  erroredPlayers: string[] = [],
  options: { previousState?: SnakeState; progress?: number; reducedMotion?: boolean } = {},
) {
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
  drawSnakeBoard(context as unknown as CanvasRenderingContext2D, state, 380, 380, {
    previousState: options.previousState ?? init(4),
    events,
    progress: options.progress ?? 0.5,
    reducedMotion: options.reducedMotion ?? false,
    erroredPlayers: new Set(erroredPlayers),
  });
  return calls;
}

test("the ground, food circles, coloured bodies, ringed heads and summaries are drawn", () => {
  const state = eliminate(init(4), 3);
  state.snakes[0]!.body = [
    { x: 4, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 2 },
  ];
  const calls = draw(state);
  expect(calls[0]).toMatchObject({
    op: "fillRect",
    args: [0, 0, 380, 380],
    fillStyle: SNAKE_PALETTE.ground,
  });
  const food = calls.filter((call) => call.op === "arc" && call.fillStyle === SNAKE_PALETTE.food);
  expect(food).toHaveLength(state.food.length);
  expect(food[0]!.args.slice(0, 2)).toStrictEqual([
    (state.food[0]!.x + 0.5) * 20,
    (state.food[0]!.y + 0.5) * 20,
  ]);
  const heads = calls.filter((call) => call.op === "fillText" && call.args[0] !== "!");
  expect(heads.map((call) => call.args[0])).toStrictEqual(["1", "2", "3"]);
  for (const slot of [0, 1, 2]) {
    const { x, y } = state.snakes[slot]!.body[0]!;
    expect(
      calls.some(
        (call) =>
          call.op === "fillRect" &&
          call.fillStyle === SNAKE_PALETTE.players[slot] &&
          call.args[0] === x * 20 + 20 * 0.06 &&
          call.args[1] === y * 20 + 20 * 0.06,
      ),
    ).toBe(true);
  }
  // Two body segments of alpha sit inset in their cells.
  for (const cell of state.snakes[0]!.body.slice(1))
    expect(
      calls.some(
        (call) =>
          call.op === "fillRect" &&
          call.fillStyle === SNAKE_PALETTE.players[0] &&
          call.args[0] === cell.x * 20 + 20 * 0.12 &&
          call.args[1] === cell.y * 20 + 20 * 0.12,
      ),
    ).toBe(true);
  expect(
    calls.filter((call) => call.op === "arc" && call.strokeStyle === SNAKE_PALETTE.headRing),
  ).toHaveLength(3);
  expect(snakePlayerSummaries(state)).toStrictEqual(
    [0, 1, 2, 3].map((slot) => ({
      id: state.snakes[slot]!.id,
      label: `P${slot + 1}`,
      color: SNAKE_PALETTE.players[slot],
      score: slot === 3 ? 0 : 3,
      alive: slot !== 3,
    })),
  );
});

test("the head slides along its move while animating and sits still with reduced motion", () => {
  const previous = init(4);
  const state = init(4);
  state.tick = 1;
  const alpha = state.snakes[0]!;
  const from = { ...alpha.body[0]! };
  alpha.body = [{ x: from.x + 1, y: from.y }, { ...from }, { ...from }];
  const previousTail = previous.snakes[0]!.body.at(-1)!;
  const events: SnakeEvent[] = [
    { type: "move", playerId: "alpha", from, to: { x: from.x + 1, y: from.y } },
  ];
  const sliding = draw(state, events, [], { previousState: previous, progress: 0.5 });
  expect(
    sliding.some(
      (call) =>
        call.op === "fillRect" &&
        call.fillStyle === SNAKE_PALETTE.players[0] &&
        call.args[0] === (from.x + 0.5) * 20 + 20 * 0.06,
    ),
  ).toBe(true);
  const settled = draw(state, events, [], { previousState: previous, reducedMotion: true });
  expect(
    settled.some(
      (call) =>
        call.op === "fillRect" &&
        call.fillStyle === SNAKE_PALETTE.players[0] &&
        call.args[0] === (from.x + 1) * 20 + 20 * 0.06,
    ),
  ).toBe(true);
  expect(previousTail).toStrictEqual(from);
});

test("a death leaves a cross in the victim's colour and an errored dead player keeps its badge", () => {
  const state = eliminate(init(4), 3);
  const fallen = init(4).snakes[3]!.body[0]!;
  const calls = draw(
    state,
    [{ type: "death", playerId: "delta", position: { x: -1, y: fallen.y }, causes: ["boundary"] }],
    ["delta"],
  );
  expect(
    calls.some((call) => call.op === "stroke" && call.strokeStyle === SNAKE_PALETTE.players[3]),
  ).toBe(true);
  const badge = calls.find((call) => call.op === "fillText" && call.args[0] === "!");
  expect(badge).toBeDefined();
  expect(calls.some((call) => call.op === "arc" && call.fillStyle === SNAKE_PALETTE.warning)).toBe(
    true,
  );
});

test("the presentation describes the published release", () => {
  expect(snakePresentation.id).toBe(snakeGame.manifest.id);
  expect(snakePresentation.getStats(snakeGame.manifest)).toStrictEqual([
    { label: "参赛人数", value: "2–4" },
    { label: "地图尺寸", value: "15–19 见方" },
    { label: "回合上限", value: "500" },
    { label: "每 tick CPU", value: "20 ms" },
  ]);
});

test("highlights name meals and eliminations with their causes", () => {
  const names = new Map([
    ["a", "Alpha"],
    ["b", "Beta"],
  ]);
  const at = { x: 1, y: 1 };
  expect(
    snakeHighlights(
      [
        { type: "move", playerId: "a", from: at, to: at },
        { type: "eat", playerId: "a", position: at },
        { type: "death", playerId: "b", position: at, causes: ["body-collision"] },
        { type: "death", playerId: "c", position: at, causes: ["starvation", "head-collision"] },
        { type: "food-spawn", position: at },
      ],
      names,
    ),
  ).toStrictEqual([
    { text: "Alpha 吃到食物", tone: "neutral" },
    { text: "Beta 出局：撞到蛇身", tone: "danger" },
    { text: "c 出局：饿死、头对头相撞", tone: "danger" },
  ]);
});
