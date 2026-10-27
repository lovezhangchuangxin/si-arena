import { DANMAKU_CONFIG, DANMAKU_MAX_TICKS, DANMAKU_PLAYERS } from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const danmakuManifest = {
  id: "danmaku",
  name: "弹幕对决",
  description:
    "两架机体在中心对称的开阔战场上以惯性全向机动、朝 16 个方向织出快慢两档弹幕（弹速都严过机体），先把对手生命打到 0 点的一方获胜。",
  release: "danmaku@0.1.0",
  botProtocolVersion: 1,
  minPlayers: DANMAKU_PLAYERS,
  maxPlayers: DANMAKU_PLAYERS,
  maxTicks: DANMAKU_MAX_TICKS,
  config: DANMAKU_CONFIG,
} satisfies GameManifest;

export const danmakuCatalogEntry: GameCatalogEntry = {
  ...danmakuManifest,
  resolvedLimits: resolveResourceLimits(),
};
