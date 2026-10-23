import { TETRIS_CONFIG, TETRIS_MAX_TICKS, TETRIS_PLAYERS } from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const tetrisManifest = {
  id: "tetris",
  name: "俄罗斯方块",
  description:
    "单人挑战：7-bag 发牌的俄罗斯方块，消行得分、每 10 行提速，堆到顶部或打满 1500 tick 结束，排行榜按你的最高分排名。",
  release: "tetris@0.1.0",
  botProtocolVersion: 1,
  minPlayers: TETRIS_PLAYERS,
  maxPlayers: TETRIS_PLAYERS,
  maxTicks: TETRIS_MAX_TICKS,
  config: TETRIS_CONFIG,
} satisfies GameManifest;

export const tetrisCatalogEntry: GameCatalogEntry = {
  ...tetrisManifest,
  resolvedLimits: resolveResourceLimits(),
};
