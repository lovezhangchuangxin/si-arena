import { danmakuManifest } from "@si-arena/game-danmaku";
import { DANMAKU_LAYOUTS } from "@si-arena/game-danmaku/sdk";
import type {
  DanmakuAction,
  DanmakuDirection,
  DanmakuPosition,
  DanmakuShot,
  DanmakuSpeed,
  DanmakuState,
} from "@si-arena/game-danmaku/sdk";
import { parseDanmakuState, danmakuRules } from "@si-arena/game-danmaku/rules";
import type { DanmakuEvent, DanmakuStepResult } from "@si-arena/game-danmaku/rules";

export type Cell = readonly [number, number];
export type TickActions = Record<string, DanmakuAction>;
export const IDS = ["alpha", "beta"] as const;

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}
export const idle = (): DanmakuAction => ({ type: "idle" });
export const act = (
  move: DanmakuDirection | null,
  fire: DanmakuShot | null,
  speed: DanmakuSpeed = "slow",
): DanmakuAction => ({ type: "act", move, fire, speed });

/** seed 0 固定抽到布局 0，便于确定性断言；其他测试显式传入 seed。 */
export const LAYOUT_SEED = DANMAKU_LAYOUTS.findIndex((layout) => layout.spawns[0]![0] === 4);

export function init(seed = 0): DanmakuState {
  return danmakuRules.init({
    seed,
    config: { ...danmakuManifest.config },
    players: IDS.map((id, slot) => ({ id, slot })),
  });
}

/** 双方位置按给定值放置，其余保持初始世界（布局取 seed 0 的）。 */
export function world(ships: readonly [Cell, Cell]): DanmakuState {
  const state = init(0);
  ships.forEach((cell, slot) => {
    const [x, y] = cell;
    const ship = required(state.ships[slot]);
    ship.position = { x, y };
  });
  return state;
}

export function bullet(
  state: DanmakuState,
  owner: number,
  cell: Cell,
  direction: DanmakuShot,
  serial = state.nextSerial++,
  speed: DanmakuSpeed = "fast",
) {
  const [x, y] = cell;
  state.bullets.push({
    serial,
    position: { x, y },
    direction,
    speed,
    owner,
  });
  return state;
}

export function step(
  state: DanmakuState,
  actions: TickActions | Record<number, DanmakuAction> = {},
): DanmakuStepResult {
  return danmakuRules.step(state, bySeat(actions));
}

/** 测试可按席位 0/1 或玩家 id 给动作。 */
function bySeat(actions: TickActions | Record<number, DanmakuAction>): TickActions {
  const byId = actions as TickActions;
  if (byId["alpha"] !== undefined || byId["beta"] !== undefined) return byId;
  const mapped: TickActions = {};
  for (const [seat, id] of IDS.entries()) {
    const action = (actions as Record<number, DanmakuAction>)[seat];
    if (action !== undefined) mapped[id] = action;
  }
  return mapped;
}

/** step 的输入世界与动作都被冻结，规则不得修改输入。 */
export function stepFrozen(
  state: DanmakuState,
  actions: TickActions | Record<number, DanmakuAction>,
): DanmakuStepResult {
  return danmakuRules.step(deepFreeze(state), deepFreeze(bySeat(actions)));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object))
      deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export const positions = (state: DanmakuState): Array<[number, number]> =>
  state.ships.map((ship) => [ship.position.x, ship.position.y]);
export const hps = (state: DanmakuState): number[] => state.ships.map((ship) => ship.hp);
/** 该 tick 的事件；传入类型时只留该类型。 */
export function eventsOf(output: DanmakuStepResult, type?: DanmakuEvent["type"]): DanmakuEvent[] {
  return type === undefined ? output.events : output.events.filter((event) => event.type === type);
}
export const at = (position: DanmakuPosition): [number, number] => [position.x, position.y];

/** 简易 xorshift 驱动的固定长度随机合法动作计划，用于重演一致性测试。 */
export function randomActions(state: DanmakuState, seed: number): TickActions[] {
  let rng = seed | 0;
  const next = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return (rng >>> 0) / 2 ** 32;
  };
  const directions = [null, "E", "NE", "N", "NW", "W", "SW", "S", "SE", "hold"] as const;
  const shots = [
    null,
    "E",
    "ENE",
    "NE",
    "NNE",
    "N",
    "NNW",
    "NW",
    "WNW",
    "W",
    "WSW",
    "SW",
    "SSW",
    "S",
    "SSE",
    "SE",
    "ESE",
  ] as const;
  const speeds = ["slow", "fast"] as const;
  const pick = <T>(values: readonly T[]): T =>
    values[Math.min(values.length - 1, Math.floor(next() * values.length))]!;
  const plan: TickActions[] = [];
  for (let tick = 0; tick < 200 && tick < state.maxTicks; tick++) {
    plan.push({
      alpha: act(pick(directions), pick(shots), pick(speeds)),
      beta: act(pick(directions), pick(shots), pick(speeds)),
    });
  }
  return plan;
}

/** 把状态送进 parse 验证一次再返回冻结副本，模拟回放装载路径。 */
export function reparsed(state: DanmakuState): DanmakuState {
  const parsed = parseDanmakuState(JSON.parse(JSON.stringify(state))) as DanmakuState;
  return parsed;
}

export type Point = DanmakuPosition;
