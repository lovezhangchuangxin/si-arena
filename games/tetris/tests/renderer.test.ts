import { expect, test } from "vitest";
import {
  TETRIS_PALETTE,
  drawTetrisBoard,
  tetrisHighlights,
  tetrisPlayerSummaries,
  tetrisPresentation,
} from "@si-arena/game-tetris/renderer";
import { tetrisGame } from "@si-arena/game-tetris/game";
import { resolveResourceLimits } from "@si-arena/protocol";
import type { TetrisEvent, TetrisState } from "@si-arena/game-tetris/sdk";
import { init, step } from "./helpers";

interface Call {
  op: string;
  args: Array<number | string>;
  fillStyle: string;
}

/** Records fill calls with the style at call time; no real canvas needed. */
function draw(
  state: TetrisState,
  events: TetrisEvent[] = [],
  options: { previousState?: TetrisState; progress?: number; reducedMotion?: boolean } = {},
) {
  const calls: Call[] = [];
  const context = {
    save() {},
    restore() {},
    createLinearGradient() {
      return { addColorStop() {} } as CanvasGradient;
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    beginPath() {},
    moveTo() {},
    lineTo() {},
    fill() {},
    stroke() {},
    fillRect(...args: number[]) {
      calls.push({ op: "fillRect", args, fillStyle: context.fillStyle });
    },
    strokeRect() {},
    fillText(text: string, x: number, y: number) {
      calls.push({ op: "fillText", args: [text, x, y], fillStyle: context.fillStyle });
    },
  };
  drawTetrisBoard(context as unknown as CanvasRenderingContext2D, state, 360, 500, {
    previousState: options.previousState ?? state,
    events,
    progress: options.progress ?? 1,
    reducedMotion: options.reducedMotion ?? true,
    erroredPlayers: new Set(),
  });
  return calls;
}

test("the presentation describes the solo game", () => {
  expect(tetrisPresentation.id).toBe("tetris");
  expect(tetrisPresentation.headline).toContain("单人");
  const stats = tetrisPresentation.getStats({
    ...tetrisGame.manifest,
    resolvedLimits: resolveResourceLimits(),
  });
  expect(stats.map((entry) => entry.value)).toEqual(["1", "10×20", "1500", "20 ms"]);
});

test("summaries expose the single player with the live score", () => {
  const state = init(3);
  const summaries = tetrisPlayerSummaries(state);
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({ id: state.playerId, label: "P1", alive: true });
  expect(summaries[0]!.score).toBe(state.score);
});

test("drawing paints the background, locked cells and the side panel", () => {
  let state = init(4);
  state = step(state, { type: "drop" }).nextState;
  const calls = draw(state);
  // Background wipe plus grid plus four locked cells plus panel text.
  expect(calls[0]).toMatchObject({ op: "fillRect" });
  const labels = calls.filter((call) => call.op === "fillText").map((call) => call.args[0]);
  expect(labels).toContain("NEXT");
  expect(labels).toContain("SCORE");
  expect(labels).toContain("LINES");
  expect(labels).toContain(String(state.lines));
});

test("cleared-row events flash only the cleared rows", () => {
  const state = init(6);
  const events: TetrisEvent[] = [
    { type: "lock", playerId: state.playerId, piece: 1, lines: 2, rows: [18, 19], gain: 4 },
  ];
  const calls = draw(state, events, { progress: 0 });
  // The flash paints near-opaque white rows on top of everything else.
  const flash = calls.filter((call) => call.fillStyle === "#F4F7FB" && call.args.length === 4);
  expect(flash.length).toBe(2);
  const emptyStart = init(6);
  const callsEmpty = draw(emptyStart, events, { progress: 0 });
  // Empty boards flash exactly the cleared rows too, not every empty row.
  const flashEmpty = callsEmpty.filter(
    (call) => call.fillStyle === "#F4F7FB" && call.args.length === 4,
  );
  expect(flashEmpty.length).toBe(2);
});

test("highlights narrate clears, tetris, level-ups and the terminal top-out", () => {
  const names = new Map([["alpha", "P1"]]);
  expect(
    tetrisHighlights(
      [{ type: "lock", playerId: "alpha", piece: 1, lines: 4, rows: [16, 17, 18, 19], gain: 4 }],
      names,
    ),
  ).toEqual([{ text: "P1 打出 TETRIS！四行同消 +4 分", tone: "neutral" }]);
  expect(
    tetrisHighlights(
      [{ type: "lock", playerId: "alpha", piece: 3, lines: 1, rows: [19], gain: 1 }],
      names,
    ),
  ).toEqual([{ text: "P1 消掉 1 行，+1 分", tone: "neutral" }]);
  expect(tetrisHighlights([{ type: "level-up", playerId: "alpha", level: 2 }], names)).toEqual([
    { text: "P1 提速：进入 level 2", tone: "neutral" },
  ]);
  expect(tetrisHighlights([{ type: "top-out", playerId: "alpha" }], names)).toEqual([
    { text: "P1 新块放不下了，挑战结束", tone: "danger" },
  ]);
  expect(tetrisHighlights([{ type: "move", playerId: "alpha", direction: "left" }], names)).toEqual(
    [],
  );
  void TETRIS_PALETTE;
});
