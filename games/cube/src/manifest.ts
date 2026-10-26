import { CUBE_CONFIG, CUBE_MAX_TICKS, CUBE_PLAYERS } from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const cubeManifest = {
  id: "cube",
  name: "魔方",
  description:
    "单人挑战：把打乱的三阶魔方还原，步数越少得分越高（满分 2000，每走一步扣 10 分），没还原不计分，排行榜按你的最高分排名。",
  release: "cube@0.1.0",
  botProtocolVersion: 1,
  minPlayers: CUBE_PLAYERS,
  maxPlayers: CUBE_PLAYERS,
  maxTicks: CUBE_MAX_TICKS,
  config: CUBE_CONFIG,
} satisfies GameManifest;

export const cubeCatalogEntry: GameCatalogEntry = {
  ...cubeManifest,
  resolvedLimits: resolveResourceLimits(),
};
