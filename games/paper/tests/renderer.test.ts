import { expect, test } from "vitest";
import {
  PAPER_PALETTE,
  drawPaperBoard,
  type PaperBoardAnimation,
} from "@si-arena/game-paper/renderer";
import type { PaperEvent } from "@si-arena/game-paper/rules";
import type { PaperState } from "@si-arena/game-paper/sdk";
import { indexAt, required, world } from "./helpers";

const WIDTH = 300,
  HEIGHT = 300; // 30×30 grid → 10×10 px cells.

interface CanvasCall {
  op: string;
  args: Array<number | string>;
  path: Array<{ x: number; y: number }>;
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  lineWidth: number;
}

/** Records draw calls with the style state captured at call time; no real canvas needed. */
function fakeContext() {
  const calls: CanvasCall[] = [];
  const path: Array<{ x: number; y: number }> = [];
  const context = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "top",
    createLinearGradient() {
      return { addColorStop() {} } as CanvasGradient;
    },
    save() {},
    restore() {},
    fillRect(...args: number[]) {
      calls.push(capture("fillRect", args));
    },
    strokeRect(...args: number[]) {
      calls.push(capture("strokeRect", args));
    },
    fillText(text: number | string, x: number, y: number) {
      calls.push(capture("fillText", [String(text), x, y]));
    },
    beginPath() {
      path.length = 0;
    },
    moveTo(x: number, y: number) {
      path.push({ x, y });
    },
    lineTo(x: number, y: number) {
      path.push({ x, y });
    },
    arc(x: number, y: number, radius: number) {
      path.push({ x, y });
      calls.push(capture("arc", [x, y, radius]));
    },
    fill() {
      calls.push(capture("fill", []));
    },
    stroke() {
      calls.push({ ...capture("stroke", []), path: [...path] });
    },
  };
  function capture(op: string, args: Array<number | string>): CanvasCall {
    return {
      op,
      args,
      path: [],
      fillStyle: context.fillStyle,
      strokeStyle: context.strokeStyle,
      globalAlpha: context.globalAlpha,
      lineWidth: context.lineWidth,
    };
  }
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

function animation(
  events: PaperEvent[],
  options: {
    progress?: number;
    reducedMotion?: boolean;
    erroredPlayers?: Iterable<string>;
    previousState?: PaperState;
  } = {},
): PaperBoardAnimation {
  return {
    previousState: options.previousState ?? world(),
    events,
    progress: options.progress ?? 1,
    reducedMotion: options.reducedMotion ?? false,
    erroredPlayers: new Set(options.erroredPlayers ?? []),
  };
}

function draw(state: PaperState, boardAnimation?: PaperBoardAnimation) {
  const canvas = fakeContext();
  drawPaperBoard(canvas.context, state, WIDTH, HEIGHT, boardAnimation);
  return canvas.calls;
}

const numeral = (calls: CanvasCall[], slot: 0 | 1) =>
  required(calls.find((call) => call.op === "fillText" && call.args[0] === String(slot + 1)));
const textCalls = (calls: CanvasCall[], text: string) =>
  calls.filter((call) => call.op === "fillText" && call.args[0] === text);
const strokeCalls = (calls: CanvasCall[], color: string) =>
  calls.filter(
    (call) => call.op === "stroke" && call.strokeStyle === color && call.path.length > 1,
  );
const ringCalls = (calls: CanvasCall[], color: string) =>
  calls.filter((call) => call.op === "arc" && call.strokeStyle === color);
const arg = (call: CanvasCall, index: number) => Number(call.args[index]);
const cross = (calls: CanvasCall[]) => strokeCalls(calls, PAPER_PALETTE.players[1]!);
const rings = (calls: CanvasCall[]) => ringCalls(calls, PAPER_PALETTE.players[0]!);
const badges = (calls: CanvasCall[]) => textCalls(calls, "!");

test("move events interpolate the head between cells until the window settles", () => {
  const before = world();
  const after = world();
  after.players[0].position = { x: 6, y: 5 };
  const events: PaperEvent[] = [
    { type: "move", playerId: "alpha", from: { x: 5, y: 5 }, to: { x: 6, y: 5 } },
  ];
  const head = (progress: number, reducedMotion = false) => {
    const call = numeral(
      draw(after, animation(events, { progress, reducedMotion, previousState: before })),
      0,
    );
    return { x: arg(call, 1), y: arg(call, 2) };
  };
  expect(head(0).x).toBeCloseTo(55);
  expect(head(0.5).x).toBeCloseTo(60);
  expect(head(1).x).toBeCloseTo(65);
  expect(head(0.5, true).x).toBeCloseTo(65);
  for (const point of [head(0), head(0.5), head(0.5, true)]) expect(point.y).toBeCloseTo(55);
});

test("trail cuts draw an attacker-colored cross that fades with progress", () => {
  const state = world();
  const events: PaperEvent[] = [
    { type: "trail-cut", playerId: "alpha", attackerId: "beta", position: { x: 6, y: 5 } },
  ];
  const fading = cross(draw(state, animation(events, { progress: 0.5 })));
  expect(fading).toHaveLength(1);
  expect(fading[0]!.globalAlpha).toBeCloseTo(0.5);
  for (const point of fading[0]!.path) {
    expect(point.x).toBeGreaterThanOrEqual(60);
    expect(point.x).toBeLessThanOrEqual(70);
    expect(point.y).toBeGreaterThanOrEqual(50);
    expect(point.y).toBeLessThanOrEqual(60);
  }
  expect(cross(draw(state, animation(events, { progress: 1 })))).toHaveLength(0);
  const staticCross = cross(draw(state, animation(events, { progress: 1, reducedMotion: true })));
  expect(staticCross).toHaveLength(1);
  expect(staticCross[0]!.globalAlpha).toBeCloseTo(0.9);
});

test("out-of-range progress clamps into the window instead of drawing off-board", () => {
  const before = world();
  const after = world();
  after.players[0].position = { x: 6, y: 5 };
  const events: PaperEvent[] = [
    { type: "move", playerId: "alpha", from: { x: 5, y: 5 }, to: { x: 6, y: 5 } },
    { type: "trail-cut", playerId: "alpha", attackerId: "beta", position: { x: 6, y: 5 } },
  ];
  const below = draw(after, animation(events, { progress: -0.5, previousState: before }));
  expect(numeral(below, 0).args[1]).toBeCloseTo(55);
  expect(cross(below)).toHaveLength(1);
  expect(cross(below)[0]!.globalAlpha).toBeCloseTo(1);
  const above = draw(after, animation(events, { progress: 1.5, previousState: before }));
  expect(numeral(above, 0).args[1]).toBeCloseTo(65);
  expect(cross(above)).toHaveLength(0);
});

test("captures flash gained cells and pulse the closer when nothing was gained", () => {
  const state = world();
  const gained: PaperEvent[] = [{ type: "capture", playerId: "alpha", cells: [indexAt(2, 2)] }];
  const flash = (progress: number) => {
    const calls = draw(state, animation(gained, { progress }));
    return required(
      calls.find(
        (call) =>
          call.op === "fillRect" &&
          call.fillStyle === PAPER_PALETTE.players[0] &&
          call.args[0] === 20,
      ),
    );
  };
  expect(flash(0).globalAlpha).toBeCloseTo(0.45);
  expect(flash(0.5).globalAlpha).toBeCloseTo(0.225);
  const settled = draw(state, animation(gained, { progress: 1 }));
  expect(
    settled.filter(
      (call) =>
        call.op === "fillRect" &&
        call.fillStyle === PAPER_PALETTE.players[0] &&
        call.args[0] === 20,
    ),
  ).toHaveLength(0);
  const outlined = draw(state, animation(gained, { progress: 1, reducedMotion: true }));
  const outline = required(
    outlined.find(
      (call) =>
        call.op === "strokeRect" &&
        call.strokeStyle === PAPER_PALETTE.players[0] &&
        call.args[0] === 21,
    ),
  );
  expect(outline.globalAlpha).toBeCloseTo(0.9);

  const empty: PaperEvent[] = [{ type: "capture", playerId: "alpha", cells: [] }];
  const pulse = ringCalls(
    draw(state, animation(empty, { progress: 0 })),
    PAPER_PALETTE.players[0]!,
  );
  expect(pulse).toHaveLength(1);
  expect(arg(pulse[0]!, 0)).toBeCloseTo(55);
  expect(arg(pulse[0]!, 1)).toBeCloseTo(55);
  expect(arg(pulse[0]!, 2)).toBeCloseTo(1);
  const midPulse = ringCalls(
    draw(state, animation(empty, { progress: 0.5 })),
    PAPER_PALETTE.players[0]!,
  );
  expect(midPulse).toHaveLength(1);
  expect(arg(midPulse[0]!, 2)).toBeCloseTo(2.5);
  expect(midPulse[0]!.globalAlpha).toBeCloseTo(0.5);
});

test("resets expand a ring at the cell the head left", () => {
  const before = world();
  const after = world();
  after.players[0].position = { x: 5, y: 14 };
  const events: PaperEvent[] = [
    {
      type: "reset",
      playerId: "alpha",
      from: { x: 5, y: 5 },
      to: { x: 5, y: 14 },
      causes: ["trail-cut"],
    },
  ];
  const early = rings(draw(after, animation(events, { progress: 0, previousState: before })));
  expect(early).toHaveLength(1);
  expect(arg(early[0]!, 0)).toBeCloseTo(55);
  expect(arg(early[0]!, 1)).toBeCloseTo(55);
  expect(arg(early[0]!, 2)).toBeCloseTo(1.75);
  expect(early[0]!.globalAlpha).toBeCloseTo(1);
  const mid = rings(draw(after, animation(events, { progress: 0.5, previousState: before })));
  expect(arg(mid[0]!, 2)).toBeCloseTo(3.375);
  expect(mid[0]!.globalAlpha).toBeCloseTo(0.5);
  expect(
    rings(draw(after, animation(events, { progress: 1, previousState: before }))),
  ).toHaveLength(0);
  const staticRing = rings(
    draw(after, animation(events, { progress: 1, reducedMotion: true, previousState: before })),
  );
  expect(staticRing).toHaveLength(1);
  expect(staticRing[0]!.globalAlpha).toBeCloseTo(0.9);
});

test("error badges stay on errored players regardless of progress or reduced motion", () => {
  const state = world();
  const events: PaperEvent[] = [];
  const marked = badges(draw(state, animation(events, { progress: 1, erroredPlayers: ["beta"] })));
  expect(marked).toHaveLength(1);
  expect(arg(marked[0]!, 1)).toBeGreaterThanOrEqual(240);
  expect(arg(marked[0]!, 1)).toBeLessThanOrEqual(250);
  expect(arg(marked[0]!, 2)).toBeGreaterThanOrEqual(140);
  expect(arg(marked[0]!, 2)).toBeLessThanOrEqual(150);
  expect(badges(draw(state, animation(events, { progress: 1 })))).toHaveLength(0);

  const before = world();
  const after = world();
  after.players[0].position = { x: 5, y: 14 };
  const gone: PaperEvent[] = [
    {
      type: "reset",
      playerId: "alpha",
      from: { x: 5, y: 5 },
      to: { x: 5, y: 14 },
      causes: ["boundary"],
    },
  ];
  const atLastPosition = badges(
    draw(after, animation(gone, { progress: 1, erroredPlayers: ["alpha"], previousState: before })),
  );
  expect(atLastPosition).toHaveLength(1);
  expect(arg(atLastPosition[0]!, 1), "the badge follows the reset head").toBeGreaterThanOrEqual(50);
  expect(arg(atLastPosition[0]!, 1)).toBeLessThanOrEqual(60);
  expect(arg(atLastPosition[0]!, 2)).toBeGreaterThanOrEqual(140);
  expect(arg(atLastPosition[0]!, 2)).toBeLessThanOrEqual(150);
});

test("drawing without animation input renders the settled board", () => {
  const state = world();
  const calls = draw(state);
  const head = numeral(calls, 0);
  expect(arg(head, 1)).toBe(55);
  expect(arg(head, 2)).toBe(55);
  expect(textCalls(calls, "!")).toHaveLength(0);
  expect(
    calls.filter((call) => call.op === "stroke" && call.strokeStyle !== PAPER_PALETTE.grid),
  ).toHaveLength(0);
  expect(calls.filter((call) => call.op === "arc")).toHaveLength(0);
});
