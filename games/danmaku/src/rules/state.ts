import { type DeepReadonly } from "@si-arena/protocol";
import {
  DANMAKU_CONFIG,
  DANMAKU_LAYOUTS,
  DANMAKU_MAX_TICKS,
  DANMAKU_MAX_VELOCITY,
  DANMAKU_PLAYERS,
  DANMAKU_SHOTS,
  DANMAKU_SPEEDS,
} from "../constants";
import type {
  DanmakuBullet,
  DanmakuPosition,
  DanmakuShot,
  DanmakuShip,
  DanmakuSpeed,
  DanmakuState,
} from "../sdk";
import { readArray, readId, readInteger, readRecord } from "./validation";

export const WIDTH = DANMAKU_CONFIG.width;
export const HEIGHT = DANMAKU_CONFIG.height;
/** 解析时的弹幕数量上限，正常对局远达不到；防御非法回放撑爆内存。 */
export const MAX_BULLETS_CAP = 4096;

export const insideMap = (position: DanmakuPosition) =>
  position.x >= 0 && position.y >= 0 && position.x < WIDTH && position.y < HEIGHT;

export function readShot(raw: unknown, label: string): DanmakuShot {
  const shot = DANMAKU_SHOTS.find((candidate) => candidate === raw);
  if (shot === undefined) throw new TypeError(`${label} must be one of ${DANMAKU_SHOTS.join(" ")}`);
  return shot;
}

export function readSpeed(raw: unknown, label: string): DanmakuSpeed {
  const speed = DANMAKU_SPEEDS.find((candidate) => candidate === raw);
  if (speed === undefined)
    throw new TypeError(`${label} must be one of ${DANMAKU_SPEEDS.join(" ")}`);
  return speed;
}

export function readPosition(raw: unknown, label: string): DanmakuPosition {
  const point = readRecord(raw, ["x", "y"], label);
  return {
    x: readInteger(point.x, 0, WIDTH - 1, `${label}.x`),
    y: readInteger(point.y, 0, HEIGHT - 1, `${label}.y`),
  };
}

/**
 * 32 位 xorshift32；只有初始化消耗随机数，step 不再改动 rngState。
 * 返回 [新状态, 0..0xffffffff 的无符号值]；存储恒为无符号，
 * 与 parseDanmakuState 的 [0, 2^32) 校验区间一致。
 */
export function nextRandom(rngState: number): readonly [number, number] {
  let value = rngState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return [value >>> 0, value >>> 0];
}

/**
 * 从 seed 抽取布局。xorshift32 对相邻小种子的输出高度线性相关，
 * 先空转两轮、再用乘法散列（Lemire）压缩到布局数，保证 6 个布局
 * 在连续 seed 段内都会均匀出现。
 */
function drawLayout(seed: number, layoutCount: number): readonly [number, number] {
  let value = seed | 0;
  for (let round = 0; round < 2; round++) value = nextRandom(value)[0];
  const bounded = Math.floor((value * layoutCount) / 2 ** 32);
  return [value, bounded];
}

export function initDanmaku(input: {
  seed: number;
  players: ReadonlyArray<{ id: string; slot: number }>;
}): DanmakuState {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff)
    throw new TypeError("seed must be an integer in [0, 2^32)");
  if (input.players.length !== DANMAKU_PLAYERS) throw new TypeError("Danmaku needs 2 players");
  const ids = new Set<string>();
  for (const player of input.players) {
    if (!Number.isInteger(player.slot) || player.slot < 0 || player.slot >= DANMAKU_PLAYERS)
      throw new TypeError("player slots must be dense");
    if (ids.has(player.id)) throw new TypeError("player ids must be unique");
    ids.add(player.id);
  }
  // 唯一一次消耗随机数：抽取战场布局。step 不再读取随机数。
  const [rngState, layout] = drawLayout(input.seed | 0, DANMAKU_LAYOUTS.length);
  const spawns = DANMAKU_LAYOUTS[layout]!.spawns;
  return {
    tick: 0,
    width: WIDTH,
    height: HEIGHT,
    maxTicks: DANMAKU_MAX_TICKS,
    layout,
    ships: input.players.map((player, slot) => ({
      id: player.id,
      slot,
      position: { x: spawns[slot]![0], y: spawns[slot]![1] },
      velocity: { x: 0, y: 0 },
      hp: DANMAKU_CONFIG.initialHp,
    })),
    bullets: [],
    nextSerial: 0,
    rngState,
  };
}

/** 惯性速度每轴钳制；分离校验与渲染共用。 */
export const clampVelocity = (component: number) =>
  Math.max(-DANMAKU_MAX_VELOCITY, Math.min(DANMAKU_MAX_VELOCITY, component));

/** Frozen states that passed validation are returned as is; anything else is copied. */
const validStates = new WeakSet<object>();

export function parseDanmakuState(raw: unknown): DeepReadonly<DanmakuState> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Danmaku state must be an object");
  }
  if (validStates.has(raw)) return raw as DeepReadonly<DanmakuState>;
  const value = readRecord(
    raw,
    ["tick", "width", "height", "maxTicks", "layout", "ships", "bullets", "nextSerial", "rngState"],
    "Danmaku state",
  );
  if (value.width !== WIDTH || value.height !== HEIGHT)
    throw new TypeError("Unsupported Danmaku battlefield size");
  if (value.maxTicks !== DANMAKU_MAX_TICKS) throw new TypeError("Unsupported Danmaku tick limit");
  const tick = readInteger(value.tick, 0, DANMAKU_MAX_TICKS, "state.tick");
  const layout = readInteger(value.layout, 0, DANMAKU_LAYOUTS.length - 1, "state.layout");
  const ships = readArray(value.ships, DANMAKU_PLAYERS, "state.ships").map(
    (rawShip, slot): DanmakuShip => {
      const ship = readRecord(rawShip, ["id", "slot", "position", "velocity", "hp"], "ship");
      if (readInteger(ship.slot, 0, DANMAKU_PLAYERS - 1, "ship slot") !== slot)
        throw new TypeError("Ship slots must be dense");
      const position = readPosition(ship.position, "ship position");
      const rawVelocity = readRecord(ship.velocity, ["x", "y"], "ship velocity");
      const velocity = {
        x: readInteger(
          rawVelocity.x,
          -DANMAKU_MAX_VELOCITY,
          DANMAKU_MAX_VELOCITY,
          "ship velocity.x",
        ),
        y: readInteger(
          rawVelocity.y,
          -DANMAKU_MAX_VELOCITY,
          DANMAKU_MAX_VELOCITY,
          "ship velocity.y",
        ),
      };
      return {
        id: readId(ship.id),
        slot,
        position,
        velocity,
        hp: readInteger(ship.hp, 0, DANMAKU_CONFIG.initialHp, "ship hp"),
      };
    },
  );
  if (!Array.isArray(value.bullets)) throw new TypeError("state.bullets must be an array");
  const bullets = readArray(value.bullets, value.bullets.length, "state.bullets").map(
    (rawBullet): DanmakuBullet => {
      const bullet = readRecord(
        rawBullet,
        ["serial", "position", "direction", "speed", "owner"],
        "bullet",
      );
      return {
        serial: readInteger(bullet.serial, 0, Number.MAX_SAFE_INTEGER, "bullet serial"),
        position: readPosition(bullet.position, "bullet position"),
        direction: readShot(bullet.direction, "bullet direction"),
        speed: readSpeed(bullet.speed, "bullet speed"),
        owner: readInteger(bullet.owner, 0, DANMAKU_PLAYERS - 1, "bullet owner"),
      };
    },
  );
  if (bullets.length > MAX_BULLETS_CAP) throw new TypeError("too many bullets");
  const state: DanmakuState = {
    tick,
    width: WIDTH,
    height: HEIGHT,
    maxTicks: DANMAKU_MAX_TICKS,
    layout,
    ships,
    bullets,
    nextSerial: readInteger(value.nextSerial, 0, Number.MAX_SAFE_INTEGER, "state.nextSerial"),
    rngState: readInteger(value.rngState, 0, 0xffffffff, "state.rngState"),
  };
  validStates.add(state);
  return state;
}
