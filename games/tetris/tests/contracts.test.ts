import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { officialBotUrl, tetrisGame, TETRIS_SDK_SOURCE } from "@si-arena/game-tetris/game";
import { readFile } from "node:fs/promises";
import { SandboxPlayer } from "@si-arena/sandbox";
import { resolveResourceLimits } from "@si-arena/protocol";
import type {
  TetrisAction,
  TetrisObservation,
  TetrisState,
  TetrisTickInput,
} from "@si-arena/game-tetris/sdk";

type CreateGame = (
  observation: unknown,
  channel: { submit(action: TetrisAction): void; reject(message: string): never },
) => TetrisTickInput["game"];
type Tick = (input: { game: TetrisTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

// The trusted SDK and official bot run in-process here to replay whole runs quickly;
// the sandbox test below runs the same bot exactly as the platform does.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "tetris-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, TETRIS_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const CONFIG = { ...tetrisGame.manifest.config };
const PLAYERS = [{ id: "solo", slot: 0 }] as const;

function inProcess(
  matchId: string,
  playerId: string,
): PlayerExecutor<TetrisObservation, TetrisAction> {
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
  const state = tetrisGame.rules.init({
    seed: 3,
    config: CONFIG,
    players: cloneJson([...PLAYERS]),
  });
  const observation = tetrisGame.rules.observe(state, "solo");
  expect(observation).not.toBeNull();
  const submitted: TetrisAction[] = [];
  const game = createGame(observation, {
    submit: (action) => submitted.push(action),
    reject: (message) => {
      throw new Error(message);
    },
  });
  expect(game.tick).toBe(0);
  expect(game.board.width).toBe(10);
  expect(game.board.cells.length).toBe(200);
  expect(game.next).toBe(state.queue[0]);
  expect(game.fallInterval).toBe(12);
  game.self.move("left");
  game.self.rotate("cw");
  game.self.drop();
  expect(submitted).toEqual([
    { type: "idle" },
    { type: "move", direction: "left" },
    { type: "rotate", rotation: "cw" },
    { type: "drop" },
  ]);
  expect(() => game.self.move("up" as never)).toThrow();
});

test("the official bot plays a full solo run that replays to the same result", async () => {
  const sink = new MemoryReplaySink<TetrisState, TetrisAction>();
  const played = await runMatch({
    matchId: "tetris-official",
    game: tetrisGame,
    players: [{ id: "solo", slot: 0, name: "Official", official: true }],
    seed: 42,
    sink,
    async createExecutor() {
      return inProcess("tetris-official", "solo");
    },
  });
  expect(played.result.players).toHaveLength(1);
  expect(played.result.players[0]).toMatchObject({ id: "solo", rank: 1 });
  expect(played.result.players[0]!.score).toBeGreaterThan(0);
  expect(played.result.reason).toBe("tick-limit");
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), tetrisGame);
  expect(replayed).toStrictEqual(played);
}, 60000);

async function runSeededMatch(): Promise<ReturnType<typeof runMatch>> {
  const sink = new MemoryReplaySink<TetrisState, TetrisAction>();
  return runMatch({
    matchId: "tetris-seed",
    game: tetrisGame,
    players: [{ id: "solo", slot: 0, name: "Bot", official: false }],
    seed: 7,
    sink,
    async createExecutor() {
      return inProcess("tetris-seed", "solo");
    },
  });
}

test("two runs on one seed end identically", async () => {
  const first = await runSeededMatch();
  const second = await runSeededMatch();
  expect(second.finalStateHash).toBe(first.finalStateHash);
  expect(second.result).toStrictEqual(first.result);
}, 60000);

test("default idle actions still finish a ranked run", async () => {
  const sink = new MemoryReplaySink<TetrisState, TetrisAction>();
  const played = await runMatch({
    matchId: "tetris-idle",
    game: tetrisGame,
    players: [{ id: "solo", slot: 0, name: "Idle", official: false }],
    seed: 5,
    sink,
    async createExecutor() {
      const executor: PlayerExecutor<TetrisObservation, TetrisAction> = {
        async execute(tick, _observation, defaultAction) {
          return {
            matchId: "tetris-idle",
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
  expect(played.result.players[0]?.rank).toBe(1);
  expect(played.result.reason).toBe("top-out");
}, 60000);

test("the official bot plays in the real sandbox without errors", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  const sink = new MemoryReplaySink<TetrisState, TetrisAction>();
  const played = await runMatch({
    matchId: "tetris-sandbox",
    game: tetrisGame,
    players: [{ id: "solo", slot: 0, name: "Official", official: true }],
    seed: 3,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: TETRIS_SDK_SOURCE,
        parseAction: tetrisGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  expect(played.result.players[0]!.score).toBeGreaterThan(0);
  void resolveResourceLimits;
}, 60000);

test("the player contract validates state and observation identity", () => {
  const state = tetrisGame.rules.init({
    seed: 1,
    config: CONFIG,
    players: cloneJson([...PLAYERS]),
  });
  expect(() =>
    tetrisGame.parseState(cloneJson(state), {
      config: CONFIG,
      players: [{ id: "other", slot: 0 }],
    }),
  ).toThrow(TypeError);
  const observation = tetrisGame.rules.observe(state, "solo");
  expect(() =>
    tetrisGame.parseObservation(observation, {
      config: CONFIG,
      players: cloneJson([...PLAYERS]),
      playerId: "solo",
      tick: 0,
    }),
  ).not.toThrow();
  expect(() =>
    tetrisGame.parseObservation(observation, {
      config: CONFIG,
      players: cloneJson([...PLAYERS]),
      playerId: "solo",
      tick: 1,
    }),
  ).toThrow(TypeError);
});

test("development files ship a prompt, SDK docs, a template and the official bot", async () => {
  const { developmentFiles } = await import("@si-arena/game-tetris/game");
  const contents = await Promise.all([
    readFile(developmentFiles.prompt, "utf8"),
    readFile(developmentFiles.sdk, "utf8"),
    readFile(developmentFiles.template, "utf8"),
    readFile(officialBotUrl, "utf8"),
  ]);
  expect(contents[0]).toContain("SI_ARENA_RESEARCH");
  expect(contents[3]).toContain("export default function tick");
});
