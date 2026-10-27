import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import type { DANMAKU_MAX_TICKS, DanmakuDirection, DanmakuShot, DanmakuSpeed } from "../constants";

export {
  DANMAKU_CONFIG,
  DANMAKU_DELTAS,
  DANMAKU_DIRECTIONS,
  DANMAKU_SHOTS,
  DANMAKU_SPEEDS,
  DANMAKU_SPEED_STEPS,
  DANMAKU_LAYOUTS,
  DANMAKU_MAX_TICKS,
} from "../constants";
export type { DanmakuDirection, DanmakuShot, DanmakuSpeed } from "../constants";
export type { DanmakuLayout } from "../constants";
export { danmakuBulletDelta } from "../constants";

export interface DanmakuPosition {
  x: number;
  y: number;
}

/** 每 tick 一个动作：移动并可同时开火，或交回默认动作（不再加速、保持漂移）。 */
export type DanmakuAction =
  | { type: "idle" }
  | {
      type: "act";
      /** 加速度输入：8 向之一、`hold`（制动）或 `null`（维持漂移）。 */
      move: DanmakuDirection | null;
      /** 弹幕方向，或 `null` 不开火。 */
      fire: DanmakuShot | null;
      /** 弹速档位；`fire` 为 `null` 时忽略。 */
      speed: DanmakuSpeed;
    };

export interface DanmakuShip {
  id: string;
  slot: number;
  /** 位置恒在战场内；本游戏没有中途阵亡离场。 */
  position: DanmakuPosition;
  /** 惯性速度，每轴 ∈ [-maxVelocity, maxVelocity]。 */
  velocity: DanmakuPosition;
  /** 落到 0 即败，终局后不再变化。 */
  hp: number;
}

export interface DanmakuBullet {
  /** 全局递增的发射序号。 */
  serial: number;
  position: DanmakuPosition;
  direction: DanmakuShot;
  /** 弹速档位，决定每 tick 沿基准位移表前进 1 或 2 格。 */
  speed: DanmakuSpeed;
  /** 发射者席位；弹幕不会命中发射者本人。 */
  owner: number;
}

export interface DanmakuState {
  tick: number;
  width: number;
  height: number;
  maxTicks: typeof DANMAKU_MAX_TICKS;
  /** seed 抽取的布局序号。 */
  layout: number;
  /** 按席位。 */
  ships: DanmakuShip[];
  /** 按发射顺序。 */
  bullets: DanmakuBullet[];
  /** 下一个弹幕 serial。 */
  nextSerial: number;
  /** 只有初始化消耗随机数；step 不再改动。 */
  rngState: number;
}

export type DanmakuEvent =
  | { type: "move"; playerId: string; from: DanmakuPosition; to: DanmakuPosition }
  | {
      type: "fire";
      playerId: string;
      position: DanmakuPosition;
      direction: DanmakuShot;
      speed: DanmakuSpeed;
    }
  | { type: "hit"; playerId: string; attackerId: string; position: DanmakuPosition; hp: number }
  | { type: "blocked"; playerId: string; position: DanmakuPosition }
  | {
      type: "destroyed";
      playerId: string;
      attackerId: string;
      position: DanmakuPosition;
      serials: number[];
    };

export interface DanmakuObservation {
  tick: number;
  maxTicks: typeof DANMAKU_MAX_TICKS;
  selfId: string;
  selfSlot: number;
  width: number;
  height: number;
  /** 按席位，双方完整信息。 */
  ships: DeepReadonly<DanmakuShip[]>;
  /** 全部在飞弹幕。 */
  bullets: DeepReadonly<DanmakuBullet[]>;
  /** 上一 tick 的公共事件，tick 0 为空。 */
  events: DeepReadonly<DanmakuEvent[]>;
}

export interface DanmakuGameView {
  readonly tick: number;
  readonly maxTicks: typeof DANMAKU_MAX_TICKS;
  readonly width: number;
  readonly height: number;
  readonly self: DeepReadonly<DanmakuShip>;
  /** 对手始终存在（本游戏没有中途阵亡离场）。 */
  readonly opponent: DeepReadonly<DanmakuShip>;
  readonly bullets: DeepReadonly<DanmakuBullet[]>;
  readonly events: DeepReadonly<DanmakuEvent[]>;
}

export interface DanmakuTickInput {
  readonly game: DanmakuGameView;
  /** JSON 恢复检查点；tick 失败后全局变量与 SDK 缓存都会丢失。 */
  readonly Memory: JsonObject;
}
