import { expect, test } from "vitest";
import { danmakuManifest } from "@si-arena/game-danmaku";
import { DANMAKU_CONFIG, DANMAKU_LAYOUTS } from "@si-arena/game-danmaku/sdk";
import type { DanmakuState } from "@si-arena/game-danmaku/sdk";
import { parseDanmakuAction, parseDanmakuState, danmakuRules } from "@si-arena/game-danmaku/rules";
import {
  IDS,
  act,
  at,
  bullet,
  deepFreeze,
  eventsOf,
  hps,
  idle,
  init,
  positions,
  randomActions,
  required,
  step,
  stepFrozen,
  world,
} from "./helpers";

test("initialization places both ships at a seeded symmetric layout with full hp", () => {
  const state = init(0);
  expect(state.tick).toBe(0);
  expect(state.maxTicks).toBe(600);
  // seed 0 恰好抽到布局 0：经典横向对峙（rng 不动点，rngState 保持 0）。
  expect(state.layout).toBe(0);
  expect(positions(state)).toStrictEqual([
    [4, 12],
    [27, 11],
  ]);
  expect(hps(state)).toStrictEqual([100, 100]);
  expect(state.bullets).toStrictEqual([]);
  // seed 0 是 xorshift 不动点，其他 seed 消耗一次 rng。
  expect(init(2).rngState).not.toBe(2);
});

test("the seed draws layouts, same seeds repeat and ships start on symmetric spawns", () => {
  expect(init(7)).toStrictEqual(init(7));
  // 不同 seed 至少在布局或 rngState 上不同。
  expect(JSON.stringify(init(7))).not.toBe(JSON.stringify(init(8)));
  // 每个布局的出生点必须中心对称（公平），且都落在战场内。
  for (const layout of DANMAKU_LAYOUTS) {
    const [a, b] = layout.spawns;
    expect(a[0] + b[0]).toBe(31);
    expect(a[1] + b[1]).toBe(23);
  }
});

test("rngState stays unsigned so every initialized world passes replay parsing", () => {
  // 回归：曾经存储有符号 32 位值，引擎官方路径每 tick 过 parse 时，
  // 符号位为 1 的种子直接抛 "rngState must be an integer between 0 and 2^32"。
  for (let seed = 0; seed < 256; seed++) {
    const state = init(seed);
    expect(state.rngState).toBeGreaterThanOrEqual(0);
    expect(state.rngState).toBeLessThanOrEqual(0xffffffff);
    expect(() => parseDanmakuState(JSON.parse(JSON.stringify(state)))).not.toThrow();
  }
});

test("initialization rejects bad seeds, player counts and duplicate identities", () => {
  const players = IDS.map((id, slot) => ({ id, slot }));
  for (const seed of [-1, 2 ** 32, 1.5, Number.NaN])
    expect(() =>
      danmakuRules.init({ seed, config: { ...danmakuManifest.config }, players }),
    ).toThrow();
  expect(() =>
    danmakuRules.init({ seed: 1, config: { ...danmakuManifest.config }, players: [players[0]!] }),
  ).toThrow();
  expect(() =>
    danmakuRules.init({
      seed: 1,
      config: { ...danmakuManifest.config },
      players: [
        { id: "alpha", slot: 0 },
        { id: "alpha", slot: 1 },
      ],
    }),
  ).toThrow();
});

test("actions parse into canonical intents, default speed to slow and reject bad fields", () => {
  expect(parseDanmakuAction({ type: "idle" })).toStrictEqual({ ok: true, action: idle() });
  expect(parseDanmakuAction({ type: "act", move: "N", fire: null })).toStrictEqual({
    ok: true,
    action: act("N", null),
  });
  expect(parseDanmakuAction({ type: "act", move: null, fire: "ESE", speed: "fast" })).toStrictEqual(
    {
      ok: true,
      action: act(null, "ESE", "fast"),
    },
  );
  expect(parseDanmakuAction({ type: "act", move: "hold", fire: "SW" })).toStrictEqual({
    ok: true,
    action: act("hold", "SW"),
  });
  // 缺省 speed 归一化为 slow。
  expect(parseDanmakuAction({ type: "act", move: "NE", fire: "SW" })).toStrictEqual({
    ok: true,
    action: act("NE", "SW", "slow"),
  });
  for (const raw of [
    null,
    7,
    "idle",
    {},
    { type: "explode" },
    { type: "act", move: "X", fire: null },
    { type: "act", move: null, fire: "EX" },
    { type: "act", move: "hold", fire: null, speed: "hyper" },
    { type: "act", move: null },
    { type: "act", fire: null },
    { type: "act", move: "N", fire: null, extra: 1 },
  ])
    expect(parseDanmakuAction(raw).ok).toBe(false);
});

test("movement is inertial: velocity accumulates, hold brakes, walls keep ships inside", () => {
  const state = world([
    [2, 5],
    [31, 23],
  ]);
  // 第一 tick 加速向东走 1 格。
  const first = step(state, { 0: act("E", null) });
  expect(at(required(first.nextState.ships[0]).position)).toStrictEqual([3, 5]);
  expect(required(first.nextState.ships[0]).velocity).toStrictEqual({ x: 1, y: 0 });
  // 第二 tick 松手（null）继续向东漂移 1 格。
  const second = step(first.nextState, { 0: act(null, null) });
  expect(at(required(second.nextState.ships[0]).position)).toStrictEqual([4, 5]);
  // 第三 tick hold 刹车：位置不变、速度清零。
  const third = step(second.nextState, { 0: act("hold", null) });
  expect(at(required(third.nextState.ships[0]).position)).toStrictEqual([4, 5]);
  expect(required(third.nextState.ships[0]).velocity).toStrictEqual({ x: 0, y: 0 });
  // 对角加速 NE：速度 (1,-1)，从 (4,5) 正常走斜格。
  const fourth = step(third.nextState, { 0: act("NE", null) });
  expect(at(required(fourth.nextState.ships[0]).position)).toStrictEqual([5, 4]);
  expect(required(fourth.nextState.ships[0]).velocity).toStrictEqual({ x: 1, y: -1 });
  expect(eventsOf(fourth, "blocked")).toHaveLength(0);
  // 继续 NE：速度保持 (1,-1)，先 x 后 y 走斜步到 [6,3]。
  const fifth = step(fourth.nextState, { 0: act("NE", null) });
  expect(at(required(fifth.nextState.ships[0]).position)).toStrictEqual([6, 3]);
  expect(required(fifth.nextState.ships[0]).velocity).toStrictEqual({ x: 1, y: -1 });
  // hold 刹车后向北走两格，第三格撞北墙 blocked 且 vy 回退。
  const brake = step(fifth.nextState, { 0: act("hold", null) });
  expect(at(required(brake.nextState.ships[0]).position)).toStrictEqual([6, 3]);
  expect(required(brake.nextState.ships[0]).velocity).toStrictEqual({ x: 0, y: 0 });
  const north1 = step(brake.nextState, { 0: act("N", null) });
  expect(at(required(north1.nextState.ships[0]).position)).toStrictEqual([6, 2]);
  const north2 = step(north1.nextState, { 0: act("N", null) });
  expect(at(required(north2.nextState.ships[0]).position)).toStrictEqual([6, 1]);
  const north3 = step(north2.nextState, { 0: act("N", null) });
  expect(at(required(north3.nextState.ships[0]).position)).toStrictEqual([6, 0]);
  const north4 = step(north3.nextState, { 0: act("N", null) });
  expect(at(required(north4.nextState.ships[0]).position)).toStrictEqual([6, 0]);
  expect(required(north4.nextState.ships[0]).velocity).toStrictEqual({ x: 0, y: 0 });
  expect(eventsOf(north4, "blocked")).toHaveLength(1);
});

test("ships can share cells and walls stop ships at the boundary", () => {
  // 摆放机体贴着东边界验证阻挡。
  const state = world([
    [31, 11],
    [0, 23],
  ]);
  // (0,23) 贴墙：向西撞墙 → blocked、位置不变且速度回退。
  const hitWall = step(state, { 0: act("E", null), 1: act("W", null) });
  expect(at(required(hitWall.nextState.ships[0]).position)).toStrictEqual([31, 11]);
  expect(required(hitWall.nextState.ships[0]).velocity).toStrictEqual({ x: 0, y: 0 });
  expect(at(required(hitWall.nextState.ships[1]).position)).toStrictEqual([0, 23]);
  expect(required(hitWall.nextState.ships[1]).velocity).toStrictEqual({ x: 0, y: 0 });
  expect(eventsOf(hitWall, "blocked")).toHaveLength(2);
  // 双方走进同一格仍放行。
  const shared = world([
    [10, 10],
    [12, 10],
  ]);
  const both = step(shared, {
    0: act("E", null),
    1: act("W", null),
  });
  expect(positions(both.nextState)).toStrictEqual([
    [11, 10],
    [11, 10],
  ]);
});

test("bullets fly along their tables at their speed tier and never hit their owner", () => {
  const state = world([
    [16, 12],
    [24, 12],
  ]);
  bullet(state, 0, [10, 12], "E");
  const flown = step(state);
  // 快弹 E 速度 4：10 -> 14。
  expect(required(flown.nextState.bullets[0]).position).toStrictEqual({ x: 14, y: 12 });
  expect(hps(flown.nextState)).toStrictEqual([100, 100]);
  // 慢弹 E 速度 2：10 -> 12。
  bullet(state, 0, [4, 14], "E", 50, "slow");
  const half = step(state);
  // 同一 tick：快弹从 10 到 14，慢弹从 4 到 6。
  expect(required(half.nextState.bullets[0]).position).toStrictEqual({ x: 14, y: 12 });
  expect(required(half.nextState.bullets[1]).position).toStrictEqual({ x: 6, y: 14 });
  const boundary = world([
    [4, 12],
    [27, 11],
  ]);
  bullet(boundary, 0, [31, 6], "ENE");
  const gone = step(boundary);
  // ENE 快弹终点 (35,5) 出界，弹幕消失。
  expect(gone.nextState.bullets).toHaveLength(0);
});

test("both bullet tiers are strictly faster than a full-speed ship", () => {
  // 机体满速切比雪夫 1 格/tick；慢弹 2 格、快弹 4 格，必须严格更快，
  // 否则追不上也甩不开，弹幕就失去威胁。
  const state = world([
    [8, 12],
    [24, 12],
  ]);
  bullet(state, 0, [8, 10], "E", 1, "slow");
  bullet(state, 0, [8, 14], "E", 2, "fast");
  // 同 tick 双方全速向东跑。
  const chased = step(state, { 0: act("E", null), 1: act("E", null) });
  expect(at(required(chased.nextState.ships[0]).position)).toStrictEqual([9, 12]);
  expect(at(required(chased.nextState.ships[1]).position)).toStrictEqual([25, 12]);
  const [slowBullet, fastBullet] = chased.nextState.bullets.map((item) => item.position);
  // 慢弹 8+2=10，与机体拉开 1 格；快弹 8+4=12，拉开 3 格。
  expect(slowBullet).toStrictEqual({ x: 10, y: 10 });
  expect(fastBullet).toStrictEqual({ x: 12, y: 14 });
});

test("fast bullets sample every cell along the proportional path (no tunneling)", () => {
  // 快弹 NNE 总位移 (2,-4)，逐格采样路径 (0,-1)->(1,-2)->(1,-3)->(2,-4)。
  // 机体站在第 3 格 (11,9) 旁边 (11,8)：中段采样必须命中，不能飞过头。
  const state = world([
    [10, 10],
    [11, 8],
  ]);
  bullet(state, 0, [10, 12], "NNE");
  const hit = step(state);
  expect(hps(hit.nextState)).toStrictEqual([100, 99]);
  expect(hit.nextState.bullets).toHaveLength(0);
});

test("a bullet within the hit radius deals one damage and is consumed", () => {
  const state = world([
    [10, 10],
    [14, 10],
  ]);
  bullet(state, 0, [11, 10], "E");
  const hit = step(state, { 0: idle(), 1: idle() });
  // 终点 13 距离 14 为 1 → 命中，hp 100→99。
  expect(hps(hit.nextState)).toStrictEqual([100, 99]);
  expect(hit.nextState.bullets).toHaveLength(0);
  const hits = eventsOf(hit, "hit");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ attackerId: "alpha", playerId: "beta", hp: 99 });
});

test("slow bullets hit adjacent ships with the per-cell samples", () => {
  const state = world([
    [10, 10],
    [12, 10],
  ]);
  bullet(state, 0, [10, 10], "E", 200, "slow");
  const hit = step(state);
  // 慢弹走 2 格到 12，逐格采样 (11,10)、(12,10)：终点距离 0 → 命中。
  expect(hps(hit.nextState)).toStrictEqual([100, 99]);
});

test("fast bullets stop on the first sampled hit along the path", () => {
  const state = world([
    [10, 10],
    [13, 10],
  ]);
  bullet(state, 0, [10, 10], "E");
  const hit = step(state);
  // 快弹 E 走 4 格，逐格采样 11、12、13、14：第 3 格 (13,10) 距离 0 → 命中并消失，
  // 不会继续采样第 4 格。
  expect(hps(hit.nextState)).toStrictEqual([100, 99]);
  expect(hit.nextState.bullets).toHaveLength(0);
});

test("bullets stop at nothing: several hits in one tick all land", () => {
  const crossed = world([
    [10, 10],
    [24, 10],
  ]);
  bullet(crossed, 0, [22, 10], "E", 100);
  bullet(crossed, 0, [24, 14], "N", 101);
  const double = step(crossed);
  // 快弹 E: 22->26，第 3 格 (25,10) 距离 24 为 1 → 命中；
  // 快弹 N: (24,14)->(24,10)，终点距离 0 → 命中。同一 tick 两发全结伤。
  expect(hps(double.nextState)).toStrictEqual([100, 98]);
  expect(double.nextState.bullets).toHaveLength(0);
});

test("same-tick overkill clamps hp at zero instead of producing a negative world", () => {
  // 回归：生命 1 的机体同 tick 吃两发曾被打到 -1，下一 tick 世界解析
  // 直接拒绝整场比赛。伤害必须钳制在 0。
  const state = world([
    [10, 10],
    [12, 10],
  ]);
  required(state.ships[1]).hp = 1;
  bullet(state, 0, [8, 10], "E", 100);
  bullet(state, 0, [11, 8], "S", 101);
  const killed = step(state);
  expect(hps(killed.nextState)).toStrictEqual([100, 0]);
  // 两发全结伤：事件里两条 hit。
  expect(eventsOf(killed, "hit")).toHaveLength(2);
  expect(() => parseDanmakuState(JSON.parse(JSON.stringify(killed.nextState)))).not.toThrow();
  // 超杀后对局立即结束且不崩溃。
  expect(killed.result?.reason).toBe("elimination");
});

test("out-of-range shots fade without events", () => {
  // 快弹 E 落点距对手 3 格：不命中，直接飞走。
  const state = world([
    [10, 11],
    [20, 11],
  ]);
  bullet(state, 0, [12, 11], "E");
  const missed = step(state);
  expect(missed.nextState.bullets).toHaveLength(1);
  expect(eventsOf(missed, "hit")).toHaveLength(0);
  expect(hps(missed.nextState)).toStrictEqual([100, 100]);
});

test("firing is capped at three bullets in flight per ship", () => {
  const state = world([
    [10, 12],
    [27, 11],
  ]);
  // 己方已有 3 发在飞（朝西，数步内全部出界）。
  bullet(state, 0, [6, 12], "W");
  bullet(state, 0, [6, 10], "W");
  bullet(state, 0, [6, 14], "W");
  const refused = step(state, { 0: act(null, "E") });
  expect(refused.nextState.bullets).toHaveLength(3);
  expect(eventsOf(refused, "fire")).toHaveLength(0);
  // 连飞数步后三发全部出界消失，可以再射。
  let current = refused.nextState;
  for (let i = 0; i < 4; i++) current = step(current).nextState;
  expect(current.bullets).toHaveLength(0);
  const ready = step(current, { 0: act(null, "E") });
  expect(eventsOf(ready, "fire")).toHaveLength(1);
  expect(ready.nextState.bullets).toHaveLength(1);
});

test("idle ships still take default actions and the match runs to the tick limit", () => {
  const state = init(3);
  let current: DanmakuState = state;
  for (let tick = 0; tick < 600; tick++) {
    const output = danmakuRules.step(current, {
      alpha: { type: "idle" },
      beta: { type: "idle" },
    });
    current = output.nextState;
    if (output.result) {
      expect(output.result.reason).toBe("tick-limit");
      expect(output.result.completedTicks).toBe(600);
      expect(output.result.players.map((player) => player.rank)).toStrictEqual([1, 1]);
      expect(output.result.players.every((player) => player.score === 100)).toBe(true);
      return;
    }
  }
  throw new Error("an idle match must end at the tick limit");
});

test("hp zero ends the match with elimination and a full-hp survivor ranks first", () => {
  const state = world([
    [10, 12],
    [20, 12],
  ]);
  required(state.ships[1]).hp = 1;
  bullet(state, 0, [16, 12], "E");
  const final = step(state);
  expect(final.result?.reason).toBe("elimination");
  expect(final.result?.players.map((player) => player.rank)).toStrictEqual([1, 2]);
  expect(final.result?.players.map((player) => player.score)).toStrictEqual([100, 0]);
  expect(eventsOf(final, "destroyed")).toHaveLength(1);
});

test("a simultaneous double kill shares rank 1", () => {
  const state = world([
    [10, 12],
    [20, 12],
  ]);
  required(state.ships[0]).hp = 1;
  required(state.ships[1]).hp = 1;
  bullet(state, 0, [17, 12], "E");
  bullet(state, 1, [13, 12], "W");
  const final = step(state);
  expect(final.result?.reason).toBe("elimination");
  expect(final.result?.players.map((player) => player.rank)).toStrictEqual([1, 1]);
  expect(final.result?.players.map((player) => player.score)).toStrictEqual([0, 0]);
});

test("random action sequences keep the world inside bounds and stay deterministic", () => {
  const runs: string[] = [];
  for (let run = 0; run < 2; run++) {
    let state = init(42);
    const plan = randomActions(state, 7);
    for (const actionsAtTick of plan) {
      const output = stepFrozen(state, actionsAtTick);
      state = output.nextState;
      for (const ship of state.ships) {
        expect(ship.position.x).toBeGreaterThanOrEqual(0);
        expect(ship.position.x).toBeLessThan(32);
        expect(ship.position.y).toBeGreaterThanOrEqual(0);
        expect(ship.position.y).toBeLessThan(24);
        expect(Math.abs(ship.velocity.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ship.velocity.y)).toBeLessThanOrEqual(1);
      }
      expect(state.bullets.length).toBeLessThanOrEqual(6);
      if (output.result) break;
    }
    runs.push(JSON.stringify([state.tick, hps(state), state.bullets.length]));
  }
  expect(runs[0]).toBe(runs[1]);
});

test("deep frozen inputs are never mutated by step", () => {
  const state = deepFreeze(
    world([
      [10, 10],
      [20, 10],
    ]),
  );
  const actions = {
    alpha: { type: "act", move: "E", fire: "E", speed: "slow" },
    beta: { type: "act", move: "W", fire: "W", speed: "fast" },
  } as const;
  expect(() => danmakuRules.step(state, deepFreeze(actions))).not.toThrow();
});

test("observation only exposes the asking player's identity and shared world", () => {
  const state = init(5);
  const alpha = danmakuRules.observe(state, "alpha");
  expect(alpha?.selfId).toBe("alpha");
  expect(alpha?.selfSlot).toBe(0);
  expect(alpha?.ships).toStrictEqual(state.ships);
  expect(alpha?.events).toStrictEqual([]);
  expect(danmakuRules.observe(state, "stranger")).toBeNull();
});

test("DANMAKU_CONFIG stays within the ship movement and bullet flight bounds", () => {
  expect(DANMAKU_CONFIG.width).toBe(32);
  expect(DANMAKU_CONFIG.height).toBe(24);
  expect(DANMAKU_CONFIG.initialHp).toBe(100);
  expect(DANMAKU_CONFIG.maxBullets).toBe(3);
  expect(DANMAKU_CONFIG.maxVelocity).toBe(1);
  expect(DANMAKU_CONFIG.hitRadius).toBe(1);
});
