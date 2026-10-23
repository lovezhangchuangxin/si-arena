import type { GameCatalogEntry } from "@si-arena/protocol";

export { TETRIS_PALETTE } from "./palette";

export {
  drawTetrisBoard,
  tetrisPlayerSummaries,
  TETRIS_ASPECT_RATIO,
  type TetrisBoardAnimation,
} from "./board";
export { tetrisHighlights } from "./highlights";

export const tetrisPresentation = {
  id: "tetris",
  headline: "单人挑战，向最高分冲刺",
  instructions: Object.freeze([
    "10×20 场地上的单人俄罗斯方块，7-bag 随机发牌，你能看到下一块。",
    "每 tick 可以左移、右移、下落、顺/逆时针旋转（带墙踢）或硬降（立即锁定）。",
    "消行得分 = 消行数 × 当前等级（4 行同消 = 4×等级），软降和硬降不计分；每 10 行升一级，重力间隔缩短。",
    "新块放不下（top-out）或打满 1500 tick 时结束，本局得分为最终成绩；排行榜按你的最高分排名。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "参赛人数", value: String(game.minPlayers) },
      { label: "场地尺寸", value: `${game.config.width}×${game.config.height}` },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
