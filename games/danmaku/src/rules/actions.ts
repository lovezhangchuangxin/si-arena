import type { ActionParseResult } from "@si-arena/protocol";
import type { DanmakuAction, DanmakuSpeed } from "../sdk";
import { DANMAKU_DIRECTIONS, DANMAKU_SHOTS, DANMAKU_SPEEDS } from "../constants";
import { readRecord } from "./validation";

/**
 * act 动作的字段校验：type/move/fire 必填（move/fire 可为 null），
 * speed 是可选的新字段（缺省 slow，不允许未知额外字段）。
 */
function readRecordLoose(raw: object, keys: readonly string[]): boolean {
  const own = Object.keys(raw);
  if (own.length < 3 || own.length > keys.length) return false;
  return own.every((key) => keys.includes(key));
}

export function parseDanmakuAction(raw: unknown): ActionParseResult<DanmakuAction> {
  try {
    if (raw === null || typeof raw !== "object") throw new TypeError("Action must be an object");
    const type = Object.getOwnPropertyDescriptor(raw, "type")?.value as unknown;
    if (type === "idle") {
      readRecord(raw, ["type"], "idle action");
      return { ok: true, action: { type: "idle" } };
    }
    const value = raw as Record<string, unknown>;
    if (value.type !== "act") throw new TypeError("Action must be idle or act");
    if (!readRecordLoose(value, ["type", "move", "fire", "speed"]))
      throw new TypeError("act action has missing or unexpected fields");
    const move = value.move;
    if (move !== null && !DANMAKU_DIRECTIONS.some((candidate) => candidate === move))
      throw new TypeError(
        "move must be null or one of " + DANMAKU_DIRECTIONS.join(" ") + " (null keeps drifting)",
      );
    const fire = value.fire;
    if (
      fire !== null &&
      fire !== undefined &&
      !DANMAKU_SHOTS.some((candidate) => candidate === fire)
    )
      throw new TypeError("fire must be null or one of " + DANMAKU_SHOTS.join(" "));
    if (
      value.speed !== undefined &&
      value.speed !== null &&
      !DANMAKU_SPEEDS.some((candidate) => candidate === value.speed)
    )
      throw new TypeError("speed must be slow or fast");
    const speed: DanmakuSpeed =
      typeof value.speed === "string" &&
      DANMAKU_SPEEDS.some((candidate) => candidate === value.speed)
        ? (value.speed as DanmakuSpeed)
        : "slow";
    return {
      ok: true,
      action: {
        type: "act",
        move: DANMAKU_DIRECTIONS.find((candidate) => candidate === move) ?? null,
        fire: DANMAKU_SHOTS.find((candidate) => candidate === fire) ?? null,
        speed,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid Danmaku action",
    };
  }
}
