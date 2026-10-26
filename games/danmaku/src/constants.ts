export const DANMAKU_CONFIG = Object.freeze({
  /** 战场宽高（整数坐标格），左上为 (0,0)。 */
  width: 32,
  height: 24,
  /** 双方初始生命。 */
  initialHp: 100,
  /** 同时在飞的己方弹幕上限，超出后本 tick 开火无效。 */
  maxBullets: 3,
  /** 命中判定半径（切比雪夫距离）。 */
  hitRadius: 1,
  /** 惯性速度上限：机体速度每轴钳制在 ±1。 */
  maxVelocity: 1,
} as const);
export const DANMAKU_MAX_TICKS = 600;
export const DANMAKU_PLAYERS = 2;
export const DANMAKU_MAX_VELOCITY = DANMAKU_CONFIG.maxVelocity;
/** 机体输入的加速度方向：8 个位移方向加 hold（制动）。「null」表示不输入、维持漂移。 */
export const DANMAKU_DIRECTIONS = Object.freeze([
  "E",
  "NE",
  "N",
  "NW",
  "W",
  "SW",
  "S",
  "SE",
  "hold",
] as const);
export type DanmakuDirection = (typeof DANMAKU_DIRECTIONS)[number];
/** 加速度位移表（y 向下为正）；hold 不产生位移，只清零速度。 */
export const DANMAKU_DELTAS: Readonly<
  Record<Exclude<DanmakuDirection, "hold">, readonly [number, number]>
> = Object.freeze({
  E: [1, 0],
  NE: [1, -1],
  N: [0, -1],
  NW: [-1, -1],
  W: [-1, 0],
  SW: [-1, 1],
  S: [0, 1],
  SE: [1, 1],
} as const);
/**
 * 弹幕飞行的 16 个方向基准位移：慢弹每 tick 位移即此表（切比雪夫距离 2），
 * 快弹两倍（切比雪夫距离 4）；均严格快于机体满速 1 格。每轴均为偶数，
 * 逐格采样的路径恒为整点。
 */
export const DANMAKU_SHOTS = Object.freeze([
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
] as const);
export type DanmakuShot = (typeof DANMAKU_SHOTS)[number];
/** 弹幕基准位移表：慢弹每 tick 即此表，快弹两倍。 */
export const DANMAKU_SHOT_DELTAS: Readonly<Record<DanmakuShot, readonly [number, number]>> =
  Object.freeze({
    E: [2, 0],
    ENE: [2, -1],
    NE: [2, -2],
    NNE: [1, -2],
    N: [0, -2],
    NNW: [-1, -2],
    NW: [-2, -2],
    WNW: [-2, -1],
    W: [-2, 0],
    WSW: [-2, 1],
    SW: [-2, 2],
    SSW: [-1, 2],
    S: [0, 2],
    SSE: [1, 2],
    SE: [2, 2],
    ESE: [2, 1],
  } as const);
/** 弹速档位：慢弹织网（每 tick 基准表 2 格）、快弹点杀（两倍 4 格）。 */
export const DANMAKU_SPEEDS = Object.freeze(["slow", "fast"] as const);
export type DanmakuSpeed = (typeof DANMAKU_SPEEDS)[number];
/** 每 tick 相对基准位移表的倍数。 */
export const DANMAKU_SPEED_STEPS: Readonly<Record<DanmakuSpeed, 1 | 2>> = Object.freeze({
  slow: 1,
  fast: 2,
});
/** 规则与渲染共用的弹幕每 tick 实际位移：机体满速 1 格，两档弹都严格更快。 */
export const danmakuBulletDelta = (
  direction: DanmakuShot,
  speed: DanmakuSpeed,
): readonly [number, number] => {
  const [baseX, baseY] = DANMAKU_SHOT_DELTAS[direction];
  const scale = DANMAKU_SPEED_STEPS[speed];
  return [baseX * scale, baseY * scale];
};
/**
 * seed 布局表：每项的出生点关于战场中心 (31/2, 23/2) 中心对称，
 * 席位 0/1 各占一个对称出生点，因此每个布局对双方公平。init 按 seed 抽取。
 */
export interface DanmakuLayout {
  readonly spawns: readonly [readonly [number, number], readonly [number, number]];
}
export const DANMAKU_LAYOUTS: readonly DanmakuLayout[] = Object.freeze([
  // 经典开阔对峙：横向远距。
  {
    spawns: [
      [4, 12],
      [27, 11],
    ],
  },
  // 近身遭遇：开局即在交战距离内。
  {
    spawns: [
      [11, 11],
      [20, 12],
    ],
  },
  // 远角大对角线开局。
  {
    spawns: [
      [4, 4],
      [27, 19],
    ],
  },
  // 经典对峙的紧凑变体。
  {
    spawns: [
      [4, 11],
      [27, 12],
    ],
  },
  // 斜角：大对角线开局。
  {
    spawns: [
      [2, 2],
      [29, 21],
    ],
  },
  // 错位开局：上下半场各偏一侧。
  {
    spawns: [
      [6, 6],
      [25, 17],
    ],
  },
] satisfies DanmakuLayout[]);
