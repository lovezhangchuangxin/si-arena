import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, resolveResourceLimits, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { SandboxPlayer } from "@si-arena/sandbox";
import { danmakuGame, DANMAKU_SDK_SOURCE, officialBotUrl } from "@si-arena/game-danmaku/game";
import { danmakuManifest } from "@si-arena/game-danmaku";
import type {
  DanmakuAction,
  DanmakuObservation,
  DanmakuState,
  DanmakuTickInput,
} from "@si-arena/game-danmaku/sdk";
import {
  parseDanmakuObservation,
  parseDanmakuState,
  danmakuRules,
} from "@si-arena/game-danmaku/rules";
import { IDS, bullet, hps, init, required, step, world } from "./helpers";

const context = (state: DanmakuState, playerId = "alpha") => ({
  config: { ...danmakuManifest.config },
  players: state.ships.map(({ id, slot }) => ({ id, slot })),
  playerId,
  tick: state.tick,
});

test("the manifest publishes a fixed 1v1 duel without an arena and with default limits", () => {
  expect(danmakuManifest).toMatchObject({
    id: "danmaku",
    botProtocolVersion: 2,
    minPlayers: 2,
    maxPlayers: 2,
    maxTicks: 600,
  });
  expect(danmakuManifest).not.toHaveProperty("arena");
  expect(danmakuGame.manifest.resolvedLimits.cpuMs).toBe(20);
  expect(danmakuGame.parseConfig(cloneJson(danmakuManifest.config))).toStrictEqual(
    danmakuManifest.config,
  );
  expect(() => danmakuGame.parseConfig({ ...danmakuManifest.config, width: 20 })).toThrow();
  expect(() => danmakuGame.parseConfig({ ...danmakuManifest.config, extra: 1 })).toThrow();
});

test("state and observation validation enforce participants and identity", () => {
  const state = init(2);
  expect(parseDanmakuState(cloneJson(state))).toStrictEqual(state);
  const observation = danmakuRules.observe(state, "beta");
  expect(observation).not.toBeNull();
  const restored = danmakuGame.parseObservation(cloneJson(observation), context(state, "beta"));
  expect(restored.selfId).toBe("beta");
  // 席位错乱的世界被拒绝。
  const broken = structuredClone(state);
  required(broken.ships[0]).slot = 1;
  expect(() => danmakuGame.parseState(cloneJson(broken), context(state))).toThrow();
  // 伪装身份的观察被拒绝。
  const forged = danmakuRules.observe(state, "alpha");
  expect(() => danmakuGame.parseObservation(cloneJson(forged), context(state, "beta"))).toThrow();
});

test("replaying recorded actions reproduces the same world and result", () => {
  let state = init(11);
  const replay: DanmakuState[] = [];
  const actions: Array<Record<string, DanmakuAction>> = [];
  for (let tick = 0; tick < 120; tick++) {
    const moves = (["E", "N", "W", "S"] as const)[tick % 4]!;
    const alphaShots = (["E", "NE", "N", "NW", "W", "SW", "S", "SE"] as const)[tick % 8]!;
    const betaMoves = (["W", "S", "E", "N"] as const)[tick % 4]!;
    const betaShots = (["W", "WSW", "SW", "SSW", "S", "SSE", "SE", "ESE"] as const)[tick % 8]!;
    actions.push({
      alpha: { type: "act", move: moves, fire: alphaShots, speed: "slow" },
      beta: { type: "act", move: betaMoves, fire: betaShots, speed: "slow" },
    });
    const output = danmakuRules.step(state, actions[tick]!);
    state = output.nextState;
    replay.push(state);
    if (output.result) break;
  }
  let rebuilt = init(11);
  for (let tick = 0; tick < actions.length; tick++) {
    const output = danmakuRules.step(rebuilt, actions[tick]!);
    rebuilt = output.nextState;
    expect(rebuilt).toStrictEqual(replay[tick]);
    if (output.result) {
      expect(JSON.stringify(rebuilt)).toStrictEqual(JSON.stringify(replay[replay.length - 1]));
      break;
    }
  }
});

const participants = () => IDS.map((id, slot) => ({ id, slot, name: id, official: true }));

type CreateGame = (
  observation: unknown,
  channel: { submit(action: DanmakuAction): void; reject(message: string): never },
) => DanmakuTickInput["game"];
type Tick = (input: { game: DanmakuTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "danmaku-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, DANMAKU_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function inProcess(
  matchId: string,
  playerId: string,
): PlayerExecutor<DanmakuObservation, DanmakuAction> {
  let memory: JsonObject = {};
  return {
    async execute(tick, observation, defaultAction) {
      let action = defaultAction;
      const game = createGame(observation, {
        submit: (next) => {
          action = next;
        },
        reject: (message) => {
          throw new Error(message);
        },
      });
      const Memory = cloneJson(memory);
      officialTick({ game, Memory });
      memory = cloneJson(Memory);
      return { matchId, playerId, tick, executionId: `${playerId}-${tick}`, ok: true, action };
    },
    async close() {},
  };
}

test("two official bots play full matches that replay to the same result", async () => {
  const reasons = new Set<string>();
  for (const seed of [7, 8, 9]) {
    const sink = new MemoryReplaySink<DanmakuState, DanmakuAction>();
    const matchId = `danmaku-${seed}`;
    const played = await runMatch({
      matchId,
      game: danmakuGame,
      players: participants(),
      seed,
      sink,
      async createExecutor(player) {
        return inProcess(matchId, player.id);
      },
    });
    expect(played.result.players).toHaveLength(2);
    expect(played.result.players.some((player) => player.rank === 1)).toBe(true);
    expect(["elimination", "tick-limit"]).toContain(played.result.reason);
    reasons.add(played.result.reason);
    expect(sink.replay.initialState).toStrictEqual(init(seed));
    const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), danmakuGame);
    expect(replayed).toStrictEqual(played);
  }
  expect(reasons.has("elimination"), "official bots do hit each other").toBe(true);
}, 60000);

test("two official bots play a full match in the real sandbox without errors", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  const relaxedGame: typeof danmakuGame = {
    ...danmakuGame,
    manifest: {
      ...danmakuGame.manifest,
      resolvedLimits: resolveResourceLimits({
        ...danmakuGame.manifest.resolvedLimits,
        cpuMs: 200,
      }),
    },
  };
  const sink = new MemoryReplaySink<DanmakuState, DanmakuAction>();
  const played = await runMatch({
    matchId: "danmaku-sandbox",
    game: relaxedGame,
    players: participants(),
    seed: 12,
    sink,
    async createExecutor(player, executorContext) {
      return await SandboxPlayer.create({
        ...executorContext,
        playerId: player.id,
        source,
        sdkSource: DANMAKU_SDK_SOURCE,
        parseAction: danmakuGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), relaxedGame);
  expect(replayed).toStrictEqual(played);
}, 60000);

test("bullet ownership and hit attribution survive a serialized round trip", () => {
  const state = world([
    [10, 10],
    [16, 10],
  ]);
  bullet(state, 1, [13, 10], "W");
  const restored = structuredClone(state);
  const hit = step(restored);
  expect(hps(hit.nextState)).toStrictEqual([99, 100]);
  const parsed = parseDanmakuState(cloneJson(hit.nextState));
  expect(parsed).toStrictEqual(hit.nextState);
  const observation = danmakuRules.observe(hit.nextState, "alpha", { events: hit.events });
  const reparsed = parseDanmakuObservation(
    cloneJson(observation),
    context(hit.nextState as DanmakuState),
  );
  expect(reparsed.events.map((event) => event.type)).toContain("hit");
});

test("the SDK rejects wrong move directions through reject()", async () => {
  const state = init(5);
  const observation = danmakuRules.observe(state, "alpha");
  expect(observation).not.toBeNull();
  const game = createGame(cloneJson(observation), {
    submit: () => {},
    reject: (message) => {
      throw new Error(message);
    },
  });
  expect(() =>
    (game.self as unknown as { act(move: string, fire: string | null): void }).act("UP", null),
  ).toThrow("Direction must be one of");
});
