import type { DeepReadonly } from "@si-arena/protocol";
import { DANMAKU_CONFIG, DANMAKU_MAX_TICKS, DANMAKU_PLAYERS } from "../constants";
import type { DanmakuEvent, DanmakuObservation, DanmakuState } from "../sdk";
import { MAX_BULLETS_CAP, readPosition, readShot, readSpeed } from "./state";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** 本游戏没有中途阵亡；打满 tick 或一方生命归零即结束。 */
export function danmakuFinished(state: DeepReadonly<DanmakuState>): boolean {
  return state.tick >= state.maxTicks || state.ships.some((ship) => ship.hp <= 0);
}

/**
 * 每 tick 事件上限（防御非法回放）：每机体最多 move + blocked 各 1（惯性
 * 移动可部分位移、部分被挡），双方共 4；fire 最多 2；双方各 3 发弹同 tick
 * 全命中共 6 hits；destroyed 最多 2。合计 14，留 2 余量取 16。
 */
const MAX_EVENTS = 16;

function readEvents(raw: unknown, ids: readonly string[]): DeepReadonly<DanmakuEvent[]> {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) throw new TypeError("Invalid Danmaku events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!ids.includes(id)) throw new TypeError("Unknown event player");
    return id;
  };
  return readArray(raw, raw.length, "events").map((item): DanmakuEvent => {
    if (item === null || typeof item !== "object") throw new TypeError("Invalid event");
    const type = Object.getOwnPropertyDescriptor(item, "type")?.value;
    if (type === "move") {
      const event = readRecord(item, ["type", "playerId", "from", "to"], "move event");
      return {
        type,
        playerId: playerId(event.playerId),
        from: readPosition(event.from, "event from"),
        to: readPosition(event.to, "event to"),
      };
    }
    if (type === "fire") {
      const event = readRecord(
        item,
        ["type", "playerId", "position", "direction", "speed"],
        "fire event",
      );
      return {
        type,
        playerId: playerId(event.playerId),
        position: readPosition(event.position, "event position"),
        direction: readShot(event.direction, "event direction"),
        speed: readSpeed(event.speed, "event speed"),
      };
    }
    if (type === "hit") {
      const event = readRecord(
        item,
        ["type", "playerId", "attackerId", "position", "hp"],
        "hit event",
      );
      return {
        type,
        playerId: playerId(event.playerId),
        attackerId: playerId(event.attackerId),
        position: readPosition(event.position, "event position"),
        hp: readInteger(event.hp, 0, DANMAKU_CONFIG.initialHp, "event hp"),
      };
    }
    if (type === "blocked") {
      const event = readRecord(item, ["type", "playerId", "position"], "blocked event");
      return {
        type,
        playerId: playerId(event.playerId),
        position: readPosition(event.position, "event position"),
      };
    }
    if (type === "destroyed") {
      const event = readRecord(
        item,
        ["type", "playerId", "attackerId", "position", "serials"],
        "destroyed event",
      );
      if (!Array.isArray(event.serials)) throw new TypeError("event serials must be an array");
      const serials = readArray(event.serials, event.serials.length, "event serials").map(
        (rawSerial) => readInteger(rawSerial, 0, Number.MAX_SAFE_INTEGER, "event serial"),
      );
      return {
        type,
        playerId: playerId(event.playerId),
        attackerId: playerId(event.attackerId),
        position: readPosition(event.position, "event position"),
        serials,
      };
    }
    throw new TypeError("Invalid event type");
  });
}

export function observeDanmaku(
  state: DeepReadonly<DanmakuState>,
  playerId: string,
  context?: { events?: DeepReadonly<DanmakuEvent[]> },
): DeepReadonly<DanmakuObservation> | null {
  const self = state.ships.find((ship) => ship.id === playerId);
  if (self === undefined) return null;
  const events = context?.events ?? [];
  return {
    tick: state.tick,
    maxTicks: state.maxTicks,
    selfId: playerId,
    selfSlot: self.slot,
    width: state.width,
    height: state.height,
    ships: state.ships,
    bullets: state.bullets.slice(0, MAX_BULLETS_CAP),
    events,
  };
}

const validObservations = new WeakSet<object>();

/** 用世界布局复核观察身份；observations 不含 rngState 等私有字段。 */
export function parseDanmakuObservation(
  raw: unknown,
  context: {
    config: DeepReadonly<Record<string, unknown>>;
    players: ReadonlyArray<{ id: string; slot: number }>;
    playerId: string;
    tick: number;
  },
): DeepReadonly<DanmakuObservation> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Danmaku observation must be an object");
  }
  if (validObservations.has(raw)) return raw as DeepReadonly<DanmakuObservation>;
  const value = readRecord(
    raw,
    ["tick", "maxTicks", "selfId", "selfSlot", "width", "height", "ships", "bullets", "events"],
    "Danmaku observation",
  );
  if (readInteger(value.tick, 0, DANMAKU_MAX_TICKS, "observation tick") !== context.tick)
    throw new TypeError("observation tick must match the world tick");
  if (
    readInteger(value.maxTicks, DANMAKU_MAX_TICKS, DANMAKU_MAX_TICKS, "observation maxTicks") !==
    DANMAKU_MAX_TICKS
  )
    throw new TypeError("Unsupported Danmaku tick limit");
  const selfId = readId(value.selfId);
  if (selfId !== context.playerId) throw new TypeError("observation selfId must be the viewer");
  const selfSlot = readInteger(value.selfSlot, 0, DANMAKU_PLAYERS - 1, "observation selfSlot");
  const self = context.players[selfSlot];
  if (self === undefined || self.id !== selfId)
    throw new TypeError("observation selfSlot must match the viewer seat");
  if (value.width !== DANMAKU_CONFIG.width || value.height !== DANMAKU_CONFIG.height)
    throw new TypeError("Unsupported Danmaku battlefield size");
  const ships = readArray(value.ships, DANMAKU_PLAYERS, "observation ships").map(
    (rawShip, slot) => {
      const ship = readRecord(rawShip, ["id", "slot", "position", "velocity", "hp"], "ship");
      if (readInteger(ship.slot, 0, DANMAKU_PLAYERS - 1, "ship slot") !== slot)
        throw new TypeError("Ship slots must be dense");
      const seat = context.players[slot];
      if (seat === undefined || readId(ship.id) !== seat.id)
        throw new TypeError("observation ship ids must match the match seats");
      const position = readPosition(ship.position, "ship position");
      const rawVelocity = readRecord(ship.velocity, ["x", "y"], "ship velocity");
      return {
        id: seat.id,
        slot,
        position,
        velocity: {
          x: readInteger(
            rawVelocity.x,
            -DANMAKU_CONFIG.maxVelocity,
            DANMAKU_CONFIG.maxVelocity,
            "ship velocity.x",
          ),
          y: readInteger(
            rawVelocity.y,
            -DANMAKU_CONFIG.maxVelocity,
            DANMAKU_CONFIG.maxVelocity,
            "ship velocity.y",
          ),
        },
        hp: readInteger(ship.hp, 0, DANMAKU_CONFIG.initialHp, "ship hp"),
      };
    },
  );
  if (ships[selfSlot]!.id !== selfId) throw new TypeError("observation ships must include self");
  if (!Array.isArray(value.bullets)) throw new TypeError("observation bullets must be an array");
  const bullets = readArray(value.bullets, value.bullets.length, "observation bullets").map(
    (rawBullet) => {
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
  const events = readEvents(
    value.events,
    context.players.map((player) => player.id),
  );
  const observation: DanmakuObservation = {
    tick: context.tick,
    maxTicks: DANMAKU_MAX_TICKS,
    selfId,
    selfSlot,
    width: DANMAKU_CONFIG.width,
    height: DANMAKU_CONFIG.height,
    ships,
    bullets,
    events,
  };
  validObservations.add(observation);
  return observation;
}
