import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { x as extract } from "tar";

interface Manifest {
  name: string;
  version: string;
  exports: Record<string, { import: string; types: string }>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error("Run this check with pnpm test:artifacts");
const pnpmIsScript = /\.[cm]?js$/.test(pnpmPath);
const runPnpm = (args: string[]) =>
  execFileSync(
    pnpmIsScript ? process.execPath : pnpmPath,
    pnpmIsScript ? [pnpmPath, ...args] : args,
    { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 60_000 },
  );
// These child processes intentionally have no TypeScript loader or test aliases.
const nodeOptions = { ...process.env, NODE_OPTIONS: "" };
const runNode = (args: string[], cwd: string) =>
  execFileSync(process.execPath, args, {
    cwd,
    env: nodeOptions,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30_000,
  });

const temporary = await mkdtemp(join(tmpdir(), "si-arena-artifacts-"));
try {
  const packs = join(temporary, "packs");
  await mkdir(packs);
  runPnpm([
    "--filter",
    "./packages/**",
    // Private game modules are distributed inside devkits; db stays server-only.
    "--filter",
    "!./packages/db",
    "--filter",
    "./games/**",
    "-r",
    "--workspace-concurrency=1",
    "pack",
    "--pack-destination",
    packs,
  ]);
  const entries: string[] = [];
  const externalDependencies: Record<string, string> = {};
  const archives = (await readdir(packs)).filter((file) => file.endsWith(".tgz"));
  assert.ok(archives.length > 0, "No distributed workspace packages were packed");
  let cliDirectory: string | undefined;
  for (const [index, archive] of archives.entries()) {
    const unpack = join(temporary, "unpack", String(index));
    await mkdir(unpack, { recursive: true });
    await extract({ file: join(packs, archive), cwd: unpack, strict: true });
    const packageDirectory = join(unpack, "package");
    const manifest = JSON.parse(
      await readFile(join(packageDirectory, "package.json"), "utf8"),
    ) as Manifest;
    for (const version of Object.values(manifest.dependencies ?? {})) {
      assert.ok(
        !version.startsWith("workspace:"),
        "Packed dependencies must not retain workspace links",
      );
    }
    for (const [name, version] of Object.entries({
      ...manifest.peerDependencies,
      ...manifest.dependencies,
    })) {
      if (!name.startsWith("@si-arena/")) externalDependencies[name] = version;
    }
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      assert.ok(
        existsSync(join(packageDirectory, entry.import)),
        `Missing JS export in ${manifest.name}: ${subpath}`,
      );
      assert.ok(
        existsSync(join(packageDirectory, entry.types)),
        `Missing type export in ${manifest.name}: ${subpath}`,
      );
      entries.push(manifest.name + (subpath === "." ? "" : subpath.slice(1)));
    }
    const target = join(temporary, "node_modules", manifest.name);
    await mkdir(dirname(target), { recursive: true });
    await rename(packageDirectory, target);
    if (manifest.name === "@si-arena/cli") cliDirectory = target;
  }
  const nodeTypes = JSON.parse(
    await readFile(join(root, "node_modules/@types/node/package.json"), "utf8"),
  ) as { version: string };
  externalDependencies["@types/node"] = nodeTypes.version;
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "si-arena-artifact-consumer",
      private: true,
      type: "module",
      dependencies: externalDependencies,
    }),
  );
  // Install real declared runtime dependencies, without workspace links or lifecycle scripts.
  runPnpm(["--dir", temporary, "install", "--ignore-scripts", "--no-frozen-lockfile"]);
  const imports = entries
    .map((id, index) => `import * as entry${index} from ${JSON.stringify(id)};`)
    .join("\n");
  const exports = entries.map((_, index) => `entry${index}`).join(", ");
  await writeFile(
    join(temporary, "consumer.ts"),
    `${imports}
export { ${exports} };
import { paperManifest } from "@si-arena/game-paper";
import { paperRules } from "@si-arena/game-paper/rules";
import type { PaperResult } from "@si-arena/game-paper/rules";
import { SandboxPlayer, createSandboxExecutor } from "@si-arena/sandbox";
import {runMatchProcess} from "@si-arena/runner";
import { resolveResourceLimits } from "@si-arena/protocol";
import { paperGame } from "@si-arena/game-paper/game";
import type { PaperState, PaperAction } from "@si-arena/game-paper/sdk";
import { MemoryReplaySink, runMatch, replayMatch } from "@si-arena/engine";
import { createReplaySession } from "@si-arena/player";
import { defineLocalGame } from "@si-arena/cli";
import { PAPER_SDK_SOURCE, officialBotUrl } from "@si-arena/game-paper/game";
const registration = defineLocalGame({game:paperGame,officialBotUrl,module:{url:import.meta.resolve("@si-arena/game-paper/game"),gameExport:"paperGame",sdkSourceExport:"PAPER_SDK_SOURCE"}});
if(registration.manifest.id!=="paper")throw new Error("Packed CLI registration failed");
let state = paperRules.init({
  seed: 2, config: paperManifest.config,
  players: [{ id: "alpha", slot: 0 }, { id: "beta", slot: 1 }],
});
let result: PaperResult | undefined;
for (let tick = 0; tick < 500; tick++) {
  const output = paperRules.step(state, { alpha: { type: "idle" }, beta: { type: "idle" } });
  state = output.nextState; result = output.result;
}
if (result?.completedTicks !== 500 || result.players.some(p => p.rank !== 1 || p.score !== 9 || !p.alive)) {
  throw new Error("Standalone match returned an unexpected result");
}
import { royaleGame, ROYALE_SDK_SOURCE, officialBotUrl as royaleBotUrl } from "@si-arena/game-royale/game";
const royaleRegistration = defineLocalGame({game:royaleGame,officialBotUrl:royaleBotUrl,module:{url:import.meta.resolve("@si-arena/game-royale/game"),gameExport:"royaleGame",sdkSourceExport:"ROYALE_SDK_SOURCE"}});
if(royaleRegistration.manifest.id!=="royale"||royaleRegistration.manifest.maxPlayers!==5)throw new Error("Packed royale registration failed");
let royaleState = royaleGame.rules.init({
  seed: 2, config: royaleGame.manifest.config,
  players: [0, 1, 2, 3, 4].map((slot) => ({ id: "p" + slot, slot })),
});
let royaleResult = undefined as ReturnType<typeof royaleGame.rules.step>["result"];
for (let tick = 0; tick < 800 && !royaleResult; tick++) {
  const output = royaleGame.rules.step(royaleState, Object.fromEntries(royaleState.players.map((p) => [p.id, { type: "idle" as const }])));
  royaleState = output.nextState; royaleResult = output.result;
}
if (royaleResult?.reason !== "tick-limit" || royaleResult.players.some(p => p.rank !== 1 || p.score !== 9)) {
  throw new Error("Standalone royale match returned an unexpected result");
}
import { snakeGame, SNAKE_SDK_SOURCE, officialBotUrl as snakeBotUrl } from "@si-arena/game-snake/game";
const snakeRegistration = defineLocalGame({game:snakeGame,officialBotUrl:snakeBotUrl,module:{url:import.meta.resolve("@si-arena/game-snake/game"),gameExport:"snakeGame",sdkSourceExport:"SNAKE_SDK_SOURCE"}});
if(snakeRegistration.manifest.id!=="snake"||snakeRegistration.manifest.maxPlayers!==4||typeof SNAKE_SDK_SOURCE!=="string")throw new Error("Packed snake registration failed");
let snakeState = snakeGame.rules.init({
  seed: 2, config: snakeGame.manifest.config,
  players: [0, 1, 2, 3].map((slot) => ({ id: "s" + slot, slot })),
});
let snakeResult = undefined as ReturnType<typeof snakeGame.rules.step>["result"];
for (let tick = 0; tick < 500 && !snakeResult; tick++) {
  const output = snakeGame.rules.step(snakeState, Object.fromEntries(snakeState.snakes.flatMap((s) => s.death ? [] : [[s.id, snakeGame.rules.defaultAction(snakeState, s.id)]])));
  snakeState = output.nextState; snakeResult = output.result;
}
// Heading straight ahead, the two snakes on each row meet head-on after seven ticks.
if (snakeResult?.reason !== "elimination" || snakeResult.completedTicks !== 7 || snakeResult.players.some(p => p.rank !== 1 || p.score !== 0)) {
  throw new Error("Standalone snake match returned an unexpected result");
}
import { bomberGame, BOMBER_SDK_SOURCE, officialBotUrl as bomberBotUrl } from "@si-arena/game-bomber/game";
const bomberRegistration = defineLocalGame({game:bomberGame,officialBotUrl:bomberBotUrl,module:{url:import.meta.resolve("@si-arena/game-bomber/game"),gameExport:"bomberGame",sdkSourceExport:"BOMBER_SDK_SOURCE"}});
if(bomberRegistration.manifest.id!=="bomber"||bomberRegistration.manifest.maxPlayers!==4)throw new Error("Packed bomber registration failed");
let bomberState = bomberGame.rules.init({
  seed: 2, config: bomberGame.manifest.config,
  players: [0, 1, 2, 3].map((slot) => ({ id: "p" + slot, slot })),
});
let bomberResult = undefined as ReturnType<typeof bomberGame.rules.step>["result"];
for (let tick = 0; tick < 400 && !bomberResult; tick++) {
  const output = bomberGame.rules.step(bomberState, Object.fromEntries(bomberState.players.map((p) => [p.id, { type: "idle" as const }])));
  bomberState = output.nextState; bomberResult = output.result;
}
// Four idle players stay on their corners and die together when ring 0 collapses.
if (bomberResult?.reason !== "elimination" || bomberResult.completedTicks !== 300 || bomberResult.players.some(p => p.rank !== 1 || p.score !== 0)) {
  throw new Error("Standalone bomber match returned an unexpected result");
}
import { tankGame, TANK_SDK_SOURCE, officialBotUrl as tankBotUrl } from "@si-arena/game-tank/game";
const tankRegistration = defineLocalGame({game:tankGame,officialBotUrl:tankBotUrl,module:{url:import.meta.resolve("@si-arena/game-tank/game"),gameExport:"tankGame",sdkSourceExport:"TANK_SDK_SOURCE"}});
if(tankRegistration.manifest.id!=="tank"||tankRegistration.manifest.maxPlayers!==2)throw new Error("Packed tank registration failed");
let tankState = tankGame.rules.init({
  seed: 2, config: tankGame.manifest.config,
  players: [{ id: "alpha", slot: 0 }, { id: "beta", slot: 1 }],
});
let tankResult = undefined as ReturnType<typeof tankGame.rules.step>["result"];
for (let tick = 0; tick < 600 && !tankResult; tick++) {
  const output = tankGame.rules.step(tankState, { alpha: { type: "idle" as const }, beta: { type: "idle" as const } });
  tankState = output.nextState; tankResult = output.result;
}
if (tankResult?.reason !== "tick-limit" || tankResult.completedTicks !== 600 || tankResult.players.some(p => p.rank !== 1 || p.score !== 3 || !p.alive)) {
  throw new Error("Standalone tank match returned an unexpected result");
}
import { tetrisGame, TETRIS_SDK_SOURCE, officialBotUrl as tetrisBotUrl } from "@si-arena/game-tetris/game";
const tetrisRegistration = defineLocalGame({game:tetrisGame,officialBotUrl:tetrisBotUrl,module:{url:import.meta.resolve("@si-arena/game-tetris/game"),gameExport:"tetrisGame",sdkSourceExport:"TETRIS_SDK_SOURCE"}});
if(tetrisRegistration.manifest.id!=="tetris"||tetrisRegistration.manifest.minPlayers!==1||tetrisRegistration.manifest.maxPlayers!==1)throw new Error("Packed tetris registration failed");
let tetrisState = tetrisGame.rules.init({
  seed: 2, config: tetrisGame.manifest.config,
  players: [{ id: "alpha", slot: 0 }],
});
let tetrisResult = undefined as ReturnType<typeof tetrisGame.rules.step>["result"];
for (let tick = 0; tick < 1500 && !tetrisResult; tick++) {
  const output = tetrisGame.rules.step(tetrisState, { alpha: { type: "idle" as const } });
  tetrisState = output.nextState; tetrisResult = output.result;
}
// An idle player never clears a line and tops out once the stack reaches the spawn row.
if (tetrisResult?.reason !== "top-out" || tetrisResult.completedTicks !== 1260 || tetrisResult.players.some(p => p.rank !== 1 || p.score !== 0)) {
  throw new Error("Standalone tetris run returned an unexpected result");
}
import { cubeGame, CUBE_SDK_SOURCE, officialBotUrl as cubeBotUrl } from "@si-arena/game-cube/game";
const cubeRegistration = defineLocalGame({game:cubeGame,officialBotUrl:cubeBotUrl,module:{url:import.meta.resolve("@si-arena/game-cube/game"),gameExport:"cubeGame",sdkSourceExport:"CUBE_SDK_SOURCE"}});
if(cubeRegistration.manifest.id!=="cube"||cubeRegistration.manifest.minPlayers!==1||cubeRegistration.manifest.maxPlayers!==1)throw new Error("Packed cube registration failed");
let cubeState = cubeGame.rules.init({
  seed: 2, config: cubeGame.manifest.config,
  players: [{ id: "alpha", slot: 0 }],
});
let cubeResult = undefined as ReturnType<typeof cubeGame.rules.step>["result"];
for (let tick = 0; tick < 400 && !cubeResult; tick++) {
  const output = cubeGame.rules.step(cubeState, { alpha: { type: "idle" as const } });
  cubeState = output.nextState; cubeResult = output.result;
}
// An idle player never turns a face, so the scramble runs out the whole tick budget.
if (cubeResult?.reason !== "tick-limit" || cubeResult.completedTicks !== 400 || cubeResult.players.some(p => p.rank !== 1 || p.score !== 0)) {
  throw new Error("Standalone cube run returned an unexpected result");
}
import { danmakuGame, DANMAKU_SDK_SOURCE, officialBotUrl as danmakuBotUrl } from "@si-arena/game-danmaku/game";
const danmakuRegistration = defineLocalGame({game:danmakuGame,officialBotUrl:danmakuBotUrl,module:{url:import.meta.resolve("@si-arena/game-danmaku/game"),gameExport:"danmakuGame",sdkSourceExport:"DANMAKU_SDK_SOURCE"}});
if(danmakuRegistration.manifest.id!=="danmaku"||danmakuRegistration.manifest.minPlayers!==2||danmakuRegistration.manifest.maxPlayers!==2)throw new Error("Packed danmaku registration failed");
let danmakuState = danmakuGame.rules.init({
  seed: 2, config: danmakuGame.manifest.config,
  players: [{ id: "alpha", slot: 0 }, { id: "beta", slot: 1 }],
});
let danmakuResult = undefined as ReturnType<typeof danmakuGame.rules.step>["result"];
for (let tick = 0; tick < 600 && !danmakuResult; tick++) {
  const output = danmakuGame.rules.step(danmakuState, { alpha: { type: "idle" as const }, beta: { type: "idle" as const } });
  danmakuState = output.nextState; danmakuResult = output.result;
}
// An idle pair never turns or fires, so the duel runs out the whole tick budget with full hp.
if (danmakuResult?.reason !== "tick-limit" || danmakuResult.completedTicks !== 600 || danmakuResult.players.some(p => p.rank !== 1 || p.score !== 100)) {
  throw new Error("Standalone danmaku run returned an unexpected result");
}
import { investmentGame, INVESTMENT_SDK_SOURCE, officialBotUrl as investmentBotUrl } from "@si-arena/game-investment/game";
const investmentRegistration = defineLocalGame({game:investmentGame,officialBotUrl:investmentBotUrl,module:{url:import.meta.resolve("@si-arena/game-investment/game"),gameExport:"investmentGame",sdkSourceExport:"INVESTMENT_SDK_SOURCE"}});
if(investmentRegistration.manifest.id!=="investment"||investmentRegistration.manifest.minPlayers!==2||investmentRegistration.manifest.maxPlayers!==4)throw new Error("Packed investment registration failed");
let investmentState = investmentGame.rules.init({
  seed: 2, config: investmentGame.manifest.config,
  players: [{ id: "alpha", slot: 0 }, { id: "beta", slot: 1 }],
});
let investmentResult = undefined as ReturnType<typeof investmentGame.rules.step>["result"];
for (let tick = 0; tick < 240 && !investmentResult; tick++) {
  const output = investmentGame.rules.step(investmentState, { alpha: { type: "idle" as const }, beta: { type: "idle" as const } });
  investmentState = output.nextState; investmentResult = output.result;
}
// Idle traders never order, so the market runs out the whole tick budget with two co-champions.
if (investmentResult?.reason !== "tick-limit" || investmentResult.completedTicks !== 240 || investmentResult.players.some(p => p.rank !== 1)) {
  throw new Error("Standalone investment run returned an unexpected result");
}
const bot = await SandboxPlayer.create({
  matchId: "artifact", playerId: "alpha", source: "let calls=0;export default ({game,Memory})=>{calls++;Memory.n=(Memory.n??0)+1;Memory.calls=calls;game.act()}",
  sdkSource: "export default (o,{submit})=>{submit({type:'idle'});return {act(){submit({type:o.fail?'invalid':'idle'})}}}",
  limits: resolveResourceLimits({cpuMs:100}),
  parseAction: paperRules.parseAction, defaultAction: {type:"idle"},
});
try {
  const first = await bot.execute(0, {});
  const second = await bot.execute(1, {});
  const failed = await bot.execute(2, {fail:true});
  const recovered = await bot.execute(3, {});
  if (!first.ok || !second.ok || second.memory.n !== 2 || second.memory.calls !== 2 || failed.ok ||
      failed.memory.n !== 2 || !recovered.ok || recovered.memory.n !== 3 || recovered.memory.calls !== 1)
    throw new Error("Packed persistent sandbox or checkpoint recovery failed");
} finally { await bot.close(); }
const processMatch = await runMatchProcess({module:{url:import.meta.resolve("@si-arena/game-paper/game"),gameExport:"paperGame",sdkSourceExport:"PAPER_SDK_SOURCE"},manifest:paperGame.manifest,matchId:"packed-runner",seed:2,isolation:{kind:"local"},sources:["export default ()=>{}","export default ()=>{}"],players:[{id:"alpha",slot:0,name:"Alpha",official:false},{id:"beta",slot:1,name:"Beta",official:true}]});
if(processMatch.errorCount || processMatch.result.completedTicks!==500 || (await replayMatch(processMatch.replayData,paperGame)).finalStateHash!==processMatch.finalStateHash)throw new Error("Packed match process failed");
const sink = new MemoryReplaySink<PaperState,PaperAction>();
const played = await runMatch({
  matchId:"packed-engine", game:paperGame, seed:2, sink,
  players:[{id:"alpha",slot:0,name:"Alpha",official:false},{id:"beta",slot:1,name:"Beta",official:true}],
  async createExecutor(player,context) {
    return createSandboxExecutor({...context,playerId:player.id,
      source:player.id==="alpha"?"export default ({game})=>{game.self.move('left')}":"export default ()=>{}",
      sdkSource:PAPER_SDK_SOURCE,
      parseAction:paperRules.parseAction,
    });
  },
});
const replayed = await replayMatch(sink.replay,paperGame);
if(played.result.reason!=="tick-limit" || replayed.finalStateHash!==played.finalStateHash)throw new Error("Packed engine/replay mismatch");
const legacyReplay = sink.replay;
legacyReplay.game.release = "paper@0.1.0";
legacyReplay.game.botProtocolVersion = 1;
let rejectedLegacy = false;
try { await registration.verify(legacyReplay); } catch { rejectedLegacy = true; }
if(!rejectedLegacy)throw new Error("Unregistered legacy release was accepted");
const playback = await createReplaySession(sink.replay,paperGame);
if(playback.frame(played.result.completedTicks).state.tick!==played.result.completedTicks || playback.frame(0).record!==null)throw new Error("Packed playback seek failed");
`,
  );
  await writeFile(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        types: ["node"],
        lib: ["ES2023", "DOM"],
        outDir: "out",
      },
      include: ["consumer.ts"],
    }),
  );
  runNode(
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "tsconfig.json")],
    temporary,
  );
  runNode(["out/consumer.js"], temporary);
  assert.ok(cliDirectory, "CLI archive is missing");
  assert.match(runNode([join(cliDirectory, "dist/main.js"), "--help"], temporary), /SI Arena CLI/);
  const cliManifest = JSON.parse(
    await readFile(join(cliDirectory, "package.json"), "utf8"),
  ) as Manifest;
  assert.equal(
    runNode([join(cliDirectory, "dist/main.js"), "--version"], temporary).trim(),
    `${cliManifest.name} ${cliManifest.version}`,
  );
  await writeFile(
    join(temporary, "arena.config.mjs"),
    `
import {defineLocalGame} from "@si-arena/cli";
import {paperGame,PAPER_SDK_SOURCE,officialBotUrl} from "@si-arena/game-paper/game";
export default [defineLocalGame({game:paperGame,officialBotUrl,module:{url:import.meta.resolve("@si-arena/game-paper/game"),gameExport:"paperGame",sdkSourceExport:"PAPER_SDK_SOURCE"}})];
`,
  );
  await writeFile(
    join(temporary, "bot.js"),
    "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;console.log(Memory.n);game.self.move('left')}",
  );
  await writeFile(join(temporary, "opponent.js"), "export default ()=>{}");
  const cliRun = runNode(
    [
      join(cliDirectory, "dist/main.js"),
      "--registry",
      "./arena.config.mjs",
      "run",
      "--bot",
      "./bot.js",
      "--opponent",
      "./opponent.js",
      "--matches",
      "2",
      "--seed",
      "42",
    ],
    temporary,
  )
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          replay?: string;
          logCount?: number;
          verified?: boolean;
          matches?: number;
        },
    );
  assert.equal(cliRun.filter((record) => record.type === "match").length, 2);
  assert.equal(cliRun.at(-1)?.matches, 2);
  const cliMatch = cliRun.find((record) => record.type === "match");
  assert.ok(cliMatch?.replay);
  assert.ok(cliMatch.logCount! > 0);
  await rm(join(temporary, "bot.js"));
  await rm(join(temporary, "opponent.js"));
  const cliReplay = runNode(
    [
      join(cliDirectory, "dist/main.js"),
      "--registry",
      "./arena.config.mjs",
      "replay",
      cliMatch.replay,
      "--verify",
      "--logs",
    ],
    temporary,
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; verified?: boolean });
  assert.ok(cliReplay.some((record) => record.type === "diagnostic"));
  assert.equal(cliReplay.at(-1)?.verified, true);
  const appUrl = pathToFileURL(join(root, "apps/server/dist/app.js")).href;
  runNode(
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    const { buildApp } = await import(${JSON.stringify(appUrl)});
    const app = buildApp();
    try {
      assert.equal((await app.inject("/health")).statusCode, 200);
      assert.equal((await app.inject("/api/games")).json().games[0].id, "paper");
    } finally { await app.close(); }
  `,
    ],
    root,
  );
  console.log(
    `Verified ${archives.length} packed packages and ${entries.length} public exports outside the workspace, strict NodeNext types, a 500-tick match, isolated sandbox, CLI batch/replay without bot files and compiled API.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
