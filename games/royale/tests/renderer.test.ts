import { expect, test } from "vitest";
import {
  ROYALE_PALETTE,
  drawRoyaleBoard,
  royalePlayerSummaries,
  royalePresentation,
  royaleHighlights,
} from "@si-arena/game-royale/renderer";
import { royaleGame } from "@si-arena/game-royale/game";
import type { RoyaleEvent, RoyaleState } from "@si-arena/game-royale/sdk";
import { eliminate, init } from "./helpers";

interface Call {
  op: string;
  args: Array<number | string>;
  fillStyle: string;
  strokeStyle: string;
}

/** Records draw calls with the style at call time; no real canvas needed. */
function draw(state: RoyaleState, events: RoyaleEvent[] = [], erroredPlayers: string[] = []) {
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
  drawRoyaleBoard(context as unknown as CanvasRenderingContext2D, state, 400, 400, {
    previousState: init(5),
    events,
    progress: 0.5,
    reducedMotion: false,
    erroredPlayers: new Set(erroredPlayers),
  });
  return calls;
}

test("the zone darkens the cells outside it and draws its border", () => {
  const state = eliminate(init(5), 4);
  state.zoneSize = 36;
  state.tick = 10;
  for (let cell = 0; cell < state.territory.length; cell++) {
    const x = cell % 40;
    const y = Math.floor(cell / 40);
    if (x < 2 || y < 2 || x > 37 || y > 37) state.territory[cell] = -1;
  }
  const calls = draw(state);
  expect(calls[0]).toMatchObject({
    op: "fillRect",
    args: [0, 0, 400, 400],
    fillStyle: ROYALE_PALETTE.outsideZone,
  });
  expect(calls[1]).toMatchObject({
    op: "fillRect",
    args: [20, 20, 360, 360],
    fillStyle: ROYALE_PALETTE.ground,
  });
  expect(
    calls.some(
      (call) =>
        call.op === "strokeRect" &&
        call.strokeStyle === ROYALE_PALETTE.zoneBorder &&
        call.args.join() === "20,20,360,360",
    ),
  ).toBe(true);
});

test("five players get their own colours, ringed heads and summaries", () => {
  const state = eliminate(init(5), 4);
  const calls = draw(state);
  const heads = calls.filter((call) => call.op === "fillText" && call.args[0] !== "!");
  expect(heads.map((call) => call.args[0])).toStrictEqual(["1", "2", "3", "4"]);
  for (const slot of [0, 1, 2, 3]) {
    const { x, y } = state.players[slot]!.position!;
    expect(
      calls.some(
        (call) =>
          call.op === "fillRect" &&
          call.fillStyle === ROYALE_PALETTE.players[slot] &&
          call.args.join() === `${x * 10},${y * 10},10,10`,
      ),
    ).toBe(true);
  }
  expect(
    calls.filter(
      (call) => call.op === "strokeRect" && call.strokeStyle === ROYALE_PALETTE.headRing,
    ),
  ).toHaveLength(4);
  expect(royalePlayerSummaries(state)).toStrictEqual(
    ROYALE_PALETTE.players.map((color, slot) => ({
      id: state.players[slot]!.id,
      label: `P${slot + 1}`,
      color,
      score: slot === 4 ? 0 : 9,
      alive: slot !== 4,
    })),
  );
});

test("a death leaves a mark in the victim's colour and an errored dead player keeps its badge", () => {
  const state = eliminate(init(5), 4);
  const fallen = init(5).players[4]!.position!;
  const calls = draw(
    state,
    [{ type: "death", playerId: "epsilon", position: fallen, causes: ["zone"] }],
    ["epsilon"],
  );
  expect(
    calls.some((call) => call.op === "arc" && call.strokeStyle === ROYALE_PALETTE.players[4]),
  ).toBe(true);
  const badge = calls.find((call) => call.op === "fillText" && call.args[0] === "!");
  expect(badge).toBeDefined();
  expect(calls.some((call) => call.op === "arc" && call.fillStyle === ROYALE_PALETTE.warning)).toBe(
    true,
  );
});

test("the presentation describes the published release", () => {
  expect(royalePresentation.id).toBe(royaleGame.manifest.id);
  expect(royalePresentation.getStats(royaleGame.manifest)).toStrictEqual([
    { label: "参赛人数", value: "2–5" },
    { label: "地图尺寸", value: "26–40 见方" },
    { label: "回合上限", value: "800" },
    { label: "每 tick CPU", value: "20 ms" },
  ]);
});

test("highlights name eliminations, their attackers and zone shrinks", () => {
  const names = new Map([
    ["a", "Alpha"],
    ["b", "Beta"],
  ]);
  const at = { x: 1, y: 1 };
  expect(
    royaleHighlights(
      [
        { type: "move", playerId: "a", from: at, to: at },
        { type: "trail-cut", playerId: "b", attackerId: "a", position: at },
        { type: "death", playerId: "b", position: at, causes: ["trail-cut"] },
        { type: "death", playerId: "c", position: at, causes: ["boundary", "zone"] },
        { type: "zone-shrink", size: 30 },
      ],
      names,
    ),
  ).toStrictEqual([
    { text: "Beta 出局：尾迹被切断，切断者 Alpha", tone: "danger" },
    { text: "c 出局：越界、留在安全区外", tone: "danger" },
    { text: "安全区收缩到 30×30", tone: "neutral" },
  ]);
});
