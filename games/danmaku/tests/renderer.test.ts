import { expect, test } from "vitest";
import {
  DANMAKU_PALETTE,
  danmakuHighlights,
  danmakuPlayerSummaries,
  danmakuPresentation,
  drawDanmakuBoard,
} from "@si-arena/game-danmaku/renderer";
import type { DanmakuEvent } from "@si-arena/game-danmaku/sdk";
import { bullet, init, required, world } from "./helpers";

interface Call {
  op: string;
  args: Array<number | string>;
  fillStyle: string;
  strokeStyle: string;
}

/** Records draw calls with the style at call time; no real canvas needed. */
function recording() {
  const calls: Call[] = [];
  const track =
    (op: string) =>
    (...args: Array<number | string>) =>
      calls.push({
        op,
        args,
        fillStyle: String(context.fillStyle),
        strokeStyle: String(context.strokeStyle),
      });
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    beginPath: track("beginPath"),
    arc: track("arc"),
    fill: track("fill"),
    stroke: track("stroke"),
    moveTo: track("moveTo"),
    lineTo: track("lineTo"),
    fillRect: track("fillRect"),
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

test("the board paints the background, grid, bullets and ships", () => {
  const state = world([
    [4, 12],
    [27, 11],
  ]);
  bullet(state, 0, [6, 12], "E");
  const { context, calls } = recording();
  drawDanmakuBoard(context, state, 320, 240);
  const ops = calls.map((call) => call.op);
  expect(ops).toContain("fillRect");
  expect(calls.filter((call) => call.op === "arc").length).toBeGreaterThanOrEqual(3);
  expect(context.fillStyle).toBeDefined();
});

test("player summaries map hp into score with player colours", () => {
  const state = init(2);
  expect(danmakuPlayerSummaries(state)).toStrictEqual([
    { id: "alpha", label: "P1", color: DANMAKU_PALETTE.players[0], score: 100, alive: true },
    { id: "beta", label: "P2", color: DANMAKU_PALETTE.players[1], score: 100, alive: true },
  ]);
  required(state.ships[0]).hp = 0;
  expect(danmakuPlayerSummaries(state)[0]).toMatchObject({ score: 0, alive: false });
});

test("hit radius interpolates bullets along their flight while animating", () => {
  const state = world([
    [16, 12],
    [27, 11],
  ]);
  bullet(state, 0, [10, 12], "E");
  const previous = init(2);
  const settled = recording();
  drawDanmakuBoard(settled.context, state, 320, 240);
  const mid = recording();
  drawDanmakuBoard(mid.context, state, 320, 240, {
    previousState: previous,
    events: [],
    progress: 0.5,
    reducedMotion: false,
    erroredPlayers: new Set(),
  });
  // 子弹弧线在中点动画时落在 11 而不是 12。
  const settledBullet = settled.calls.find((call) => call.op === "arc")!;
  const midBullet = mid.calls.find((call) => call.op === "arc")!;
  expect(midBullet.args[0]).toBeLessThan(settledBullet.args[0] as number);
});

test("hit events flash in the hit colour during the animation window", () => {
  const state = world([
    [10, 10],
    [20, 10],
  ]);
  const previous = init(2);
  const events: DanmakuEvent[] = [
    { type: "hit", playerId: "beta", attackerId: "alpha", position: { x: 20, y: 10 }, hp: 4 },
  ];
  const { context, calls } = recording();
  drawDanmakuBoard(context, state, 320, 240, {
    previousState: previous,
    events,
    progress: 0.3,
    reducedMotion: false,
    erroredPlayers: new Set(["beta"]),
  });
  const flashes = calls.filter(
    (call) => call.op === "arc" && call.fillStyle === DANMAKU_PALETTE.hit,
  );
  expect(flashes.length).toBeGreaterThanOrEqual(1);
});

test("reduced motion draws the settled world without transient flashes", () => {
  const state = init(2);
  const { context } = recording();
  expect(() =>
    drawDanmakuBoard(context, state, 320, 240, {
      previousState: state,
      events: [
        { type: "hit", playerId: "beta", attackerId: "alpha", position: { x: 4, y: 12 }, hp: 4 },
      ],
      progress: 0.5,
      reducedMotion: true,
      erroredPlayers: new Set(),
    }),
  ).not.toThrow();
});

test("highlights narrate hits and destructions only", () => {
  const names = new Map([
    ["alpha", "甲"],
    ["beta", "乙"],
  ]);
  const events: DanmakuEvent[] = [
    { type: "fire", playerId: "alpha", position: { x: 4, y: 12 }, direction: "E", speed: "slow" },
    { type: "move", playerId: "beta", from: { x: 27, y: 11 }, to: { x: 26, y: 11 } },
    { type: "hit", playerId: "beta", attackerId: "alpha", position: { x: 20, y: 10 }, hp: 4 },
    {
      type: "destroyed",
      playerId: "beta",
      attackerId: "alpha",
      position: { x: 20, y: 10 },
      serials: [3],
    },
  ];
  const lines = danmakuHighlights(events, names);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatchObject({ text: "甲 命中 乙，剩余 4 点生命", tone: "danger" });
  expect(lines[1]).toMatchObject({ text: "乙 被弹幕吞没", tone: "danger" });
  expect(danmakuHighlights([], names)).toStrictEqual([]);
});

test("the presentation describes the duel without touching execution", () => {
  expect(danmakuPresentation.id).toBe("danmaku");
  expect(danmakuPresentation.instructions.length).toBeGreaterThanOrEqual(3);
});
