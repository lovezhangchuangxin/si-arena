import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { officialBotUrl, cubeGame, CUBE_SDK_SOURCE } from "@si-arena/game-cube/game";
import { SandboxPlayer } from "@si-arena/sandbox";
import type {
  CubeAction,
  CubeObservation,
  CubeState,
  CubeTickInput,
} from "@si-arena/game-cube/sdk";

type CreateGame = (
  observation: unknown,
  channel: { submit(action: CubeAction): void; reject(message: string): never },
) => CubeTickInput["game"];
type Tick = (input: { game: CubeTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

// The trusted SDK and official bot run in-process here to replay whole runs quickly;
// the sandbox test below runs the same bot exactly as the platform does.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "cube-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, CUBE_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const CONFIG = { ...cubeGame.manifest.config };
const PLAYERS = [{ id: "solo", slot: 0 }] as const;

function inProcess(matchId: string, playerId: string): PlayerExecutor<CubeObservation, CubeAction> {
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

test("the SDK exposes the public facts and submits canonical actions", () => {
  const state = cubeGame.rules.init({ seed: 3, config: CONFIG, players: cloneJson([...PLAYERS]) });
  const observation = cubeGame.rules.observe(state, "solo");
  expect(observation).not.toBeNull();
  const submitted: CubeAction[] = [];
  const game = createGame(observation, {
    submit: (action) => submitted.push(action),
    reject: (message) => {
      throw new Error(message);
    },
  });
  expect(game.tick).toBe(0);
  expect(game.maxTicks).toBe(cubeGame.manifest.maxTicks);
  expect(game.facelets).toHaveLength(54);
  expect(game.facelets).toEqual(state.facelets);
  expect(game.scrambleLength).toBe(CONFIG.scramble);
  game.self.turn("R");
  game.self.turn("U2");
  expect(submitted).toEqual([
    { type: "idle" },
    { type: "move", move: "R" },
    { type: "move", move: "U2" },
  ]);
  expect(() => game.self.turn("X" as never)).toThrow();
});

test("the official bot solves the cube and replays to the same result", async () => {
  const sink = new MemoryReplaySink<CubeState, CubeAction>();
  const played = await runMatch({
    matchId: "cube-official",
    game: cubeGame,
    players: [{ id: "solo", slot: 0, name: "Official", official: true }],
    seed: 42,
    sink,
    async createExecutor() {
      return inProcess("cube-official", "solo");
    },
  });
  expect(played.result.reason).toBe("solved");
  expect(played.result.players).toHaveLength(1);
  expect(played.result.players[0]).toMatchObject({ id: "solo", rank: 1 });
  expect(played.result.players[0]!.score).toBeGreaterThan(0);
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), cubeGame);
  expect(replayed).toStrictEqual(played);
}, 60000);

async function runSeededMatch(): Promise<ReturnType<typeof runMatch>> {
  const sink = new MemoryReplaySink<CubeState, CubeAction>();
  return runMatch({
    matchId: "cube-seed",
    game: cubeGame,
    players: [{ id: "solo", slot: 0, name: "Bot", official: false }],
    seed: 7,
    sink,
    async createExecutor() {
      return inProcess("cube-seed", "solo");
    },
  });
}

test("two runs on one seed end identically", async () => {
  const first = await runSeededMatch();
  const second = await runSeededMatch();
  expect(second.finalStateHash).toBe(first.finalStateHash);
  expect(second.result).toStrictEqual(first.result);
}, 60000);

test("default idle actions burn the tick budget and score nothing", async () => {
  const sink = new MemoryReplaySink<CubeState, CubeAction>();
  const played = await runMatch({
    matchId: "cube-idle",
    game: cubeGame,
    players: [{ id: "solo", slot: 0, name: "Idle", official: false }],
    seed: 5,
    sink,
    async createExecutor() {
      const executor: PlayerExecutor<CubeObservation, CubeAction> = {
        async execute(tick, _observation, defaultAction) {
          return {
            matchId: "cube-idle",
            playerId: "solo",
            tick,
            executionId: `solo-${tick}`,
            ok: true,
            action: defaultAction,
          };
        },
        async close() {},
      };
      return executor;
    },
  });
  expect(played.result.reason).toBe("tick-limit");
  expect(played.result.players[0]).toEqual({ id: "solo", rank: 1, score: 0 });
}, 60000);

test("the official bot plays in the real sandbox without errors", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  const sink = new MemoryReplaySink<CubeState, CubeAction>();
  const played = await runMatch({
    matchId: "cube-sandbox",
    game: cubeGame,
    players: [{ id: "solo", slot: 0, name: "Official", official: true }],
    seed: 3,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: CUBE_SDK_SOURCE,
        parseAction: cubeGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  expect(played.result.reason).toBe("solved");
  expect(played.result.players[0]!.score).toBeGreaterThan(0);
}, 120000);

test("the player contract validates state and observation identity", () => {
  const state = cubeGame.rules.init({ seed: 1, config: CONFIG, players: cloneJson([...PLAYERS]) });
  expect(() =>
    cubeGame.parseState(cloneJson(state), {
      config: CONFIG,
      players: [{ id: "other", slot: 0 }],
    }),
  ).toThrow(TypeError);
  const observation = cubeGame.rules.observe(state, "solo");
  expect(() =>
    cubeGame.parseObservation(observation, {
      config: CONFIG,
      players: cloneJson([...PLAYERS]),
      playerId: "solo",
      tick: 0,
    }),
  ).not.toThrow();
  expect(() =>
    cubeGame.parseObservation(observation, {
      config: CONFIG,
      players: cloneJson([...PLAYERS]),
      playerId: "solo",
      tick: 1,
    }),
  ).toThrow(TypeError);
});

test("development files ship a prompt, SDK docs, a template and the official bot", async () => {
  const { developmentFiles } = await import("@si-arena/game-cube/game");
  const contents = await Promise.all([
    readFile(developmentFiles.prompt, "utf8"),
    readFile(developmentFiles.sdk, "utf8"),
    readFile(developmentFiles.template, "utf8"),
    readFile(officialBotUrl, "utf8"),
  ]);
  expect(contents[0]).toContain("SI_ARENA_RESEARCH");
  expect(contents[1]).toContain("game.self.turn");
  expect(contents[2]).toContain("export default function tick");
  expect(contents[3]).toContain("export default function tick");
});
