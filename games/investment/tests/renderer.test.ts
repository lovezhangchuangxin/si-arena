import { expect, test } from "vitest";
import {
  INVESTMENT_PALETTE,
  investmentHighlights,
  investmentPlayerSummaries,
  investmentPresentation,
  drawInvestmentBoard,
} from "@si-arena/game-investment/renderer";
import type { InvestmentEvent } from "@si-arena/game-investment/sdk";
import { init, step } from "./helpers";

interface Call {
  op: string;
  args: Array<number | string>;
  fillStyle: string;
}

/** Records draw calls with the style at call time; no real canvas needed. */
function recording() {
  const calls: Call[] = [];
  const track =
    (op: string) =>
    (...args: Array<number | string>) =>
      calls.push({ op, args, fillStyle: String(context.fillStyle) });
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    beginPath: track("beginPath"),
    arc: track("arc"),
    closePath: track("closePath"),
    save: track("save"),
    restore: track("restore"),
    setLineDash: track("setLineDash"),
    fill: track("fill"),
    stroke: track("stroke"),
    moveTo: track("moveTo"),
    lineTo: track("lineTo"),
    fillRect: track("fillRect"),
    fillText: track("fillText"),
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

test("the board paints the market columns and the worth bar", () => {
  const state = init(0);
  const { context, calls } = recording();
  drawInvestmentBoard(context, state, 640, 360);
  const ops = calls.map((call) => call.op);
  expect(ops).toContain("fillRect");
  expect(ops).toContain("fillText");
  expect(ops).toContain("lineTo");
  // 价格按整数元展示（回归：曾误除以 100），带方向箭头前缀。
  const texts = calls.filter((call) => call.op === "fillText").map((call) => String(call.args[0]));
  expect(texts.some((text) => text.endsWith("—100"))).toBe(true);
  expect(texts.some((text) => text.endsWith("—80"))).toBe(true);
  expect(texts.some((text) => text.includes("0.1"))).toBe(false);
  expect(context.fillStyle).toBeDefined();
});

test("player summaries map net worth into scores", () => {
  const state = step(init(0)).nextState;
  const summaries = investmentPlayerSummaries(state);
  expect(summaries).toHaveLength(2);
  expect(summaries[0]!.score).toBeGreaterThan(0);
  expect(summaries[0]!.alive).toBe(true);
});

test("highlights narrate trades, rejections and news", () => {
  const events: InvestmentEvent[] = [
    {
      type: "trade",
      playerId: "alpha",
      asset: "comet",
      side: "buy",
      quantity: 10,
      value: 200,
      fee: 1,
      cash: 999_799,
    },
    { type: "rejected", playerId: "beta", asset: "beam", side: "buy" },
    {
      type: "news",
      news: { serial: 1, tick: 5, asset: "spark", positive: true, magnitudeBps: 1200 },
    },
    { type: "interest", playerId: "alpha", amount: 200, cash: 1_000_200 },
  ];
  const lines = investmentHighlights(
    events,
    new Map([
      ["alpha", "甲"],
      ["beta", "乙"],
    ]),
  );
  expect(lines.some((line) => line.text.includes("买入"))).toBe(true);
  expect(lines.some((line) => line.text.includes("被拒"))).toBe(true);
  expect(lines.some((line) => line.text.includes("利好"))).toBe(true);
  expect(lines.some((line) => line.text.includes("利息"))).toBe(true);
  // 红涨绿跌：利好为 up（红）、利空为 down（绿）。
  expect(lines.some((line) => line.tone === "up" && line.text.includes("+"))).toBe(true);
  for (const line of lines) expect(["danger", "down", "neutral", "up"]).toContain(line.tone);
});

test("the presentation exposes the arena stats", () => {
  const entry = {
    minPlayers: 2,
    maxPlayers: 4,
    maxTicks: 240,
    resolvedLimits: { cpuMs: 20 },
  };
  expect(investmentPresentation.id).toBe("investment");
  expect(investmentPresentation.instructions.length).toBeGreaterThan(0);
  expect(investmentPresentation.getStats(entry as never)).toContainEqual({
    label: "席位数",
    value: "2-4",
  });
  expect(INVESTMENT_PALETTE.up).toBeDefined();
});
