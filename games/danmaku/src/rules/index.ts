import {
  type DeepReadonly,
  type GameResult,
  type GameRules,
  type InitInput,
} from "@si-arena/protocol";
import type {
  DanmakuAction,
  DanmakuEvent,
  DanmakuObservation,
  DanmakuShip,
  DanmakuState,
} from "../sdk";
import { DANMAKU_CONFIG, DANMAKU_DELTAS, danmakuBulletDelta } from "../constants";
import { parseDanmakuAction } from "./actions";
import { danmakuFinished, observeDanmaku } from "./observation";
import { clampVelocity, initDanmaku, insideMap } from "./state";

export { parseDanmakuAction } from "./actions";
export { parseDanmakuState, initDanmaku } from "./state";
export { danmakuFinished, observeDanmaku, parseDanmakuObservation } from "./observation";
export type { DanmakuEvent } from "../sdk";

export interface DanmakuResult extends GameResult {
  /** `elimination` 为一方生命归零，`tick-limit` 为打满 tick。 */
  reason: "elimination" | "tick-limit";
  players: Array<{ id: string; rank: number; score: number; hp: number }>;
}
export interface DanmakuStepResult {
  nextState: DanmakuState;
  events: DanmakuEvent[];
  result?: GameResult | undefined;
}
export type DanmakuRules = GameRules<DanmakuState, DanmakuObservation, DanmakuAction, DanmakuEvent>;
const HIT_RADIUS = DANMAKU_CONFIG.hitRadius;

/** 切比雪夫距离 ≤ hitRadius 时命中。 */
const hitAt = (ship: DanmakuShip, x: number, y: number) =>
  Math.max(Math.abs(ship.position.x - x), Math.abs(ship.position.y - y)) <= HIT_RADIUS;

/** 生命多者第 1；同 tick 双双归零并列第 1。 */
function outcome(state: DanmakuState): GameResult | undefined {
  if (!danmakuFinished(state)) return undefined;
  const eliminated = state.ships.some((ship) => ship.hp <= 0);
  return {
    reason: eliminated ? "elimination" : "tick-limit",
    completedTicks: state.tick,
    players: state.ships.map((ship) => ({
      id: ship.id,
      rank: state.ships.some((other) => other.hp > ship.hp) ? 2 : 1,
      score: ship.hp,
      hp: ship.hp,
    })),
  };
}

/** 工作副本：step 从不改输入世界。 */
function workingCopy(state: DeepReadonly<DanmakuState>): DanmakuState {
  return {
    ...state,
    ships: state.ships.map((ship) => ({
      ...ship,
      position: { ...ship.position },
      velocity: { ...ship.velocity },
    })),
    bullets: state.bullets.map((bullet) => ({ ...bullet, position: { ...bullet.position } })),
  };
}

export const danmakuRules: DanmakuRules = {
  init(input: InitInput): DanmakuState {
    return initDanmaku(input);
  },

  observe(state, playerId, context) {
    return observeDanmaku(state, playerId, context);
  },

  parseAction(raw) {
    return parseDanmakuAction(raw);
  },

  defaultAction() {
    return { type: "idle" };
  },

  step(state, actions) {
    const next = workingCopy(state);
    const events: DanmakuEvent[] = [];

    // ── 阶段 1：惯性移动（move 是加速度）────────────────────────
    // v = clamp(v + accel)，然后按新速度逐格位移。出界只吞掉撞上的
    // 那一步并回退该轴速度；机体不会被卡死，下 tick 仍可重新加速。
    for (const ship of next.ships) {
      const action = actions[ship.id];
      if (action === undefined || action.type !== "act") continue;
      if (action.move === "hold") {
        // 刹车：速度清零，位置不变，不发 move 事件。
        ship.velocity.x = 0;
        ship.velocity.y = 0;
        continue;
      }
      const [ax, ay] = action.move === null ? [0, 0] : DANMAKU_DELTAS[action.move];
      // 速度在施加加速度后立即更新：先加速、再按新速度走格。
      ship.velocity.x = clampVelocity(ship.velocity.x + ax);
      ship.velocity.y = clampVelocity(ship.velocity.y + ay);
      const from = { ...ship.position };
      let x = ship.position.x;
      let y = ship.position.y;
      let blocked = false;
      // 逐格走 |vx| + |vy| 步，每步先 x 后 y；撞上障碍/出界则回退该步速度。
      const stepAxis = (dx: number, dy: number) => {
        if (dx === 0 && dy === 0) return;
        const nx = x + dx;
        const ny = y + dy;
        if (!insideMap({ x: nx, y: ny })) {
          blocked = true;
          ship.velocity.x -= dx;
          ship.velocity.y -= dy;
          return;
        }
        x = nx;
        y = ny;
      };
      for (let index = 0; index < Math.abs(ship.velocity.x); index++)
        stepAxis(Math.sign(ship.velocity.x), 0);
      for (let index = 0; index < Math.abs(ship.velocity.y); index++)
        stepAxis(0, Math.sign(ship.velocity.y));
      ship.position.x = x;
      ship.position.y = y;
      if (blocked) events.push({ type: "blocked", playerId: ship.id, position: { ...from } });
      if (x !== from.x || y !== from.y)
        events.push({ type: "move", playerId: ship.id, from, to: { ...ship.position } });
    }

    // ── 阶段 2：同时开火（按席位顺序产生 serial）────────────────
    for (const ship of next.ships) {
      const action = actions[ship.id];
      if (action === undefined || action.type !== "act" || action.fire === null) continue;
      const inFlight = next.bullets.filter((bullet) => bullet.owner === ship.slot).length;
      if (inFlight >= DANMAKU_CONFIG.maxBullets) continue;
      next.bullets.push({
        serial: next.nextSerial,
        position: { ...ship.position },
        direction: action.fire,
        speed: action.speed,
        owner: ship.slot,
      });
      events.push({
        type: "fire",
        playerId: ship.id,
        position: { ...ship.position },
        direction: action.fire,
        speed: action.speed,
      });
      next.nextSerial += 1;
    }

    // ── 阶段 3：弹幕飞行与命中判定 ──────────────────────────────
    // 慢弹每 tick 走基准位移表（切比雪夫 2 格），快弹两倍（4 格），
    // 均严格快于机体满速 1 格。路径按比例逐格推进（floor 保持整点），
    // 每一格都与某架非发射者机体做切比雪夫 ≤ 1 命中判定；出界即消失。
    // 同一 tick 多发命中同一机体全部结伤。
    const survivors: typeof next.bullets = [];
    const destroyed = new Map<string, { attackerId: string; serials: number[] }>();
    for (const bullet of next.bullets) {
      const [dx, dy] = danmakuBulletDelta(bullet.direction, bullet.speed);
      const cells = Math.max(Math.abs(dx), Math.abs(dy));
      const owner = next.ships.find((other) => other.slot === bullet.owner)!;
      let consumed = false;
      for (let step = 1; step <= cells && !consumed; step++) {
        const cellX = bullet.position.x + Math.floor((dx * step) / cells);
        const cellY = bullet.position.y + Math.floor((dy * step) / cells);
        if (!insideMap({ x: cellX, y: cellY })) {
          // 出界：弹幕消失，不出事件。
          consumed = true;
          break;
        }
        for (const ship of next.ships) {
          if (ship.slot === bullet.owner) continue;
          if (hitAt(ship, cellX, cellY)) {
            // 伤害钳到 0：同 tick 多发超杀不允许出现负生命，
            // 否则下一 tick 的世界解析会拒绝该状态。
            ship.hp = Math.max(0, ship.hp - 1);
            const record = destroyed.get(ship.id);
            if (record) record.serials.push(bullet.serial);
            else destroyed.set(ship.id, { attackerId: owner.id, serials: [bullet.serial] });
            events.push({
              type: "hit",
              playerId: ship.id,
              attackerId: owner.id,
              position: { x: ship.position.x, y: ship.position.y },
              hp: Math.max(0, ship.hp),
            });
            consumed = true;
            break;
          }
        }
      }
      if (consumed) continue;
      bullet.position.x += dx;
      bullet.position.y += dy;
      survivors.push(bullet);
    }
    next.bullets = survivors;

    // ── 阶段 4：终局整理 ─────────────────────────────────────────
    for (const [id, record] of destroyed) {
      const ship = next.ships.find((other) => other.id === id)!;
      if (ship.hp > 0) continue;
      events.push({
        type: "destroyed",
        playerId: id,
        attackerId: record.attackerId,
        position: { ...ship.position },
        serials: record.serials,
      });
    }
    next.tick += 1;
    const result = outcome(next);
    // exactOptionalPropertyTypes：未结束时不能显式携带 undefined 键。
    return result === undefined ? { nextState: next, events } : { nextState: next, events, result };
  },
};
