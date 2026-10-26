import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import {
  defineReplayGame,
  loadRegisteredReplay,
  readBrowserReplay,
  type ReplayDrawOptions,
} from "../../src/browser";
import type { ReplayFrame } from "../../src/session";
import { fixture, type Action, type State } from "../fixture";

const blob = (raw: Uint8Array) => new Blob([new Uint8Array(raw)]);
test("browser gzip reader handles real replay files and rejects corruption/invalid UTF-8", async () => {
  const { replay } = await fixture(4);
  expect(await readBrowserReplay(blob(gzipSync(JSON.stringify(replay))))).toEqual(replay);
  for (const bytes of [Buffer.from("not gzip"), gzipSync(Buffer.from([0xff])), gzipSync("{broken")])
    await expect(readBrowserReplay(blob(bytes))).rejects.toThrow();
});
test("compressed and expanded byte limits are enforced before exposing replay JSON", async () => {
  await expect(readBrowserReplay(new Blob([new Uint8Array(32 * 1024 * 1024 + 1)]))).rejects.toThrow(
    /32 MiB/,
  );
  const compressed = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1, 32));
  await expect(readBrowserReplay(blob(compressed))).rejects.toThrow(/64 MiB/);
}, 10000);
test("cancelled reads reject and release the stream", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(readBrowserReplay(blob(gzipSync("{}")), controller.signal)).rejects.toThrow();
});
test("trusted registry matches the exact release and never imports file-supplied modules", async () => {
  const { game, replay } = await fixture(4);
  const entry = defineReplayGame({
    game,
    aspectRatio: 2,
    scoreUnit: "分",
    draw() {},
    summarize(state) {
      return state.players.map((p) => ({
        id: p.id,
        label: p.id,
        score: state.counter,
        alive: true,
        color: "#ffffff",
      }));
    },
  });
  const session = await loadRegisteredReplay(replay, [entry]);
  expect(session.totalTicks).toBe(4);
  expect(session.view(1).record?.tick).toBe(0);
  expect(session.view(4).players[0]?.score).toBe(6);
  expect(session.aspectRatio).toBe(2);
  await expect(
    loadRegisteredReplay(
      {
        ...replay,
        game: { ...replay.game, release: "counter@old", module: "file:///never-import.js" },
      },
      [entry],
    ),
  ).rejects.toThrow(/未注册/);
  await expect(loadRegisteredReplay(replay, [entry, entry])).rejects.toThrow(/未注册/);
  await expect(
    loadRegisteredReplay(
      { ...replay, game: { ...replay.game, module: "file:///never-import.js" } },
      [entry],
    ),
  ).rejects.toThrow();
});
test("view.draw forwards the replay frame and draw options verbatim", async () => {
  const { game, replay } = await fixture(4);
  const calls: Array<
    [
      CanvasRenderingContext2D,
      ReplayFrame<State, Action, { tick: number }>,
      number,
      number,
      ReplayDrawOptions,
    ]
  > = [];
  const entry = defineReplayGame({
    game,
    aspectRatio: 2,
    scoreUnit: "分",
    draw(...args) {
      calls.push(args);
    },
    summarize(state) {
      return state.players.map((p) => ({
        id: p.id,
        label: p.id,
        score: state.counter,
        alive: true,
        color: "#ffffff",
      }));
    },
  });
  const session = await loadRegisteredReplay(replay, [entry]);
  const context = {} as CanvasRenderingContext2D;
  const options = { progress: 0.25, reducedMotion: true };
  session.view(2).draw?.(context, 320, 160, options);
  expect(calls).toHaveLength(1);
  const [drawContext, frame, width, height, drawOptions] = calls[0]!;
  expect(drawContext).toBe(context);
  expect(width).toBe(320);
  expect(height).toBe(160);
  expect(drawOptions).toBe(options);
  expect(frame.state.tick).toBe(2);
  expect(frame.previousState.tick).toBe(1);
  expect(frame.events).toEqual([{ tick: 1 }]);
  expect(frame.record?.tick).toBe(1);
});
