import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, resolveResourceLimits, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { SandboxPlayer } from "@si-arena/sandbox";
import {
  investmentGame,
  INVESTMENT_SDK_SOURCE,
  officialBotUrl,
} from "@si-arena/game-investment/game";
import { investmentManifest } from "@si-arena/game-investment";
import type {
  InvestmentAction,
  InvestmentObservation,
  InvestmentState,
  InvestmentTickInput,
} from "@si-arena/game-investment/sdk";
import { investmentRules, parseInvestmentState } from "@si-arena/game-investment/rules";
import { IDS, init, order, required } from "./helpers";

const context = (state: InvestmentState, playerId = "alpha") => ({
  config: { ...investmentManifest.config },
  players: state.traders.map(({ id, slot }) => ({ id, slot })),
  playerId,
  tick: state.tick,
});

test("the manifest publishes a 4-seat arena with default limits", () => {
  expect(investmentManifest).toMatchObject({
    id: "investment",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 4,
    maxTicks: 240,
  });
  expect(investmentManifest.arena).toMatchObject({ seats: 4, keepMatches: 3 });
  expect(investmentGame.manifest.resolvedLimits.cpuMs).toBe(20);
  expect(investmentGame.parseConfig(cloneJson(investmentManifest.config))).toStrictEqual(
    investmentManifest.config,
  );
  expect(() =>
    investmentGame.parseConfig({ ...investmentManifest.config, initialCash: 5 }),
  ).toThrow();
});

test("state and observation validation enforce participants and identity", () => {
  const state = init(2);
  expect(parseInvestmentState(cloneJson(state))!).toBeDefined();
  expect(parseInvestmentState(cloneJson(state))!).toStrictEqual(state);
  const observation = investmentRules.observe(state, "beta");
  expect(observation).not.toBeNull();
  const restored = investmentGame.parseObservation(cloneJson(observation), context(state, "beta"));
  expect(restored.selfId).toBe("beta");
  // 席位错乱的世界被拒绝。
  const broken = cloneJson(state);
  required(broken.traders[0]).slot = 1;
  expect(() => investmentGame.parseState(cloneJson(broken), context(state))).toThrow();
  // 伪装身份的观察被拒绝。
  const forged = investmentRules.observe(state, "alpha");
  expect(() =>
    investmentGame.parseObservation(cloneJson(forged), context(state, "beta")),
  ).toThrow();
});

test("replaying recorded actions reproduces the same world and result", () => {
  let state = init(11);
  const replay: InvestmentState[] = [];
  const actions: Array<Record<string, InvestmentAction>> = [];
  for (let tick = 0; tick < 240; tick++) {
    actions.push({
      alpha: order(tick % 2 ? "spark" : "comet", "buy", 50 + (tick % 7)),
      beta: tick % 3 === 0 ? order("beam", "buy", 40) : { type: "idle" },
    });
    const output = investmentRules.step(state, actions[tick]!);
    state = output.nextState;
    replay.push(state);
    if (output.result) break;
  }
  expect(state.tick).toBe(240);
  let rebuilt = init(11);
  for (let tick = 0; tick < actions.length; tick++) {
    const output = investmentRules.step(rebuilt, actions[tick]!);
    rebuilt = output.nextState;
    expect(rebuilt).toStrictEqual(replay[tick]);
  }
});

const participants = () =>
  IDS.slice(0, 2).map((id, slot) => ({ id, slot, name: id, official: true }));

type CreateGame = (
  observation: unknown,
  channel: { submit(action: InvestmentAction): void; reject(message: string): never },
) => InvestmentTickInput["game"];
type Tick = (input: { game: InvestmentTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "investment-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, INVESTMENT_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function inProcess(
  matchId: string,
  playerId: string,
): PlayerExecutor<InvestmentObservation, InvestmentAction> {
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
  for (const seed of [7, 8, 9]) {
    const sink = new MemoryReplaySink<InvestmentState, InvestmentAction>();
    const matchId = `investment-${seed}`;
    const played = await runMatch({
      matchId,
      game: investmentGame,
      players: participants(),
      seed,
      sink,
      async createExecutor(player) {
        return inProcess(matchId, player.id);
      },
    });
    expect(played.result.players).toHaveLength(2);
    expect(played.result.reason).toBe("tick-limit");
    expect(played.result.completedTicks).toBe(240);
    expect(sink.replay.initialState).toStrictEqual(init(seed));
    const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), investmentGame);
    expect(replayed).toStrictEqual(played);
    // 官方 bot 必须真的在交易：事件里出现成交。
    const trades = sink.replay.ticks
      .flatMap((tick) => Object.values(tick.actions ?? {}))
      .filter((action) => action.type === "order");
    expect(trades.length).toBeGreaterThan(0);
  }
}, 60000);

test("two official bots play a full match in the real sandbox without errors", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  const relaxedGame: typeof investmentGame = {
    ...investmentGame,
    manifest: {
      ...investmentGame.manifest,
      resolvedLimits: resolveResourceLimits({
        ...investmentGame.manifest.resolvedLimits,
        cpuMs: 200,
      }),
    },
  };
  const sink = new MemoryReplaySink<InvestmentState, InvestmentAction>();
  const played = await runMatch({
    matchId: "investment-sandbox",
    game: relaxedGame,
    players: participants(),
    seed: 12,
    sink,
    async createExecutor(player, executorContext) {
      return await SandboxPlayer.create({
        ...executorContext,
        playerId: player.id,
        source,
        sdkSource: INVESTMENT_SDK_SOURCE,
        parseAction: investmentGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), relaxedGame);
  expect(replayed).toStrictEqual(played);
}, 60000);

test("observations expose histories, news and public books to every seat", () => {
  let state = init(5);
  state = investmentRules.step(state, {
    alpha: order("spark", "buy", 100),
    beta: order("comet", "buy", 100),
  }).nextState;
  for (const id of IDS.slice(0, 2)) {
    const observation = investmentRules.observe(state, id, { events: [] });
    expect(observation).not.toBeNull();
    expect(observation!.assets).toHaveLength(4);
    expect(observation!.assets[2]!.price).toBe(state.prices[2]);
    expect(observation!.assets[2]!.history.at(-1)).toBe(state.prices[2]);
    expect(observation!.traders).toHaveLength(2);
  }
});

test("the SDK rejects malformed orders through reject()", () => {
  const state = init(5);
  const observation = investmentRules.observe(state, "alpha");
  expect(observation).not.toBeNull();
  const game = createGame(cloneJson(observation), {
    submit: () => {},
    reject: (message) => {
      throw new Error(message);
    },
  });
  expect(() =>
    (game.self as unknown as { buy(asset: string, quantity: number): void }).buy("gold", 100),
  ).toThrow("Asset must be one of");
  expect(() =>
    (game.self as unknown as { buy(asset: string, quantity: number): void }).buy("anchor", 1.5),
  ).toThrow("Quantity must be an integer");
});
