import type { GameCatalogEntry } from "@si-arena/protocol";
import { CUBE_CONFIG, CUBE_MOVE_COST, CUBE_SCORE_BASE, CUBE_SCORE_ZERO_MOVES } from "../constants";

export { CUBE_PALETTE } from "./palette";

export {
  cubeScene,
  cubeStickerColour,
  cubePlayerSummaries,
  CUBE_ASPECT_RATIO,
  type CubeScene,
  type CubeSceneAnimation,
  type CubeSceneCubie,
  type CubeScenePanel,
  type CubeSceneSpin,
} from "./scene";
export { cubeHighlights } from "./highlights";

export const cubePresentation = {
  id: "cube",
  headline: "单人挑战，用最少的步数还原魔方",
  instructions: Object.freeze([
    "把打乱的三阶魔方还原：每 tick 可以转一个面，不转就空过一 tick。",
    "动作只有十八种：U、D、L、R、F、B 六个面，各带 90°、180° 和 -90° 三个变体。",
    `每走一步扣 ${CUBE_MOVE_COST} 分，满分 ${CUBE_SCORE_BASE}；${CUBE_SCORE_ZERO_MOVES} 步之后得分归零。`,
    "还原即结算，没还原不计分；排行榜按你的最高分排名，随时可以重开刷新纪录。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "参赛人数", value: String(game.minPlayers) },
      { label: "打乱步数", value: String(CUBE_CONFIG.scramble) },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
