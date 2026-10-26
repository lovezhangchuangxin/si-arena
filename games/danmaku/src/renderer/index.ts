import type { GameCatalogEntry } from "@si-arena/protocol";

export { DANMAKU_PALETTE } from "./palette";

export { drawDanmakuBoard, danmakuPlayerSummaries, type DanmakuBoardAnimation } from "./board";
export { danmakuHighlights } from "./highlights";

export const DANMAKU_ASPECT_RATIO = 32 / 24;

export const danmakuPresentation = {
  id: "danmaku",
  headline: "惯性走位、快慢织弹",
  instructions: Object.freeze([
    "两架机体在 32×24 的对称战场上漂移走位：move 是加速度，速度会保留，hold 才能刹住。",
    "每 tick 可同时朝 16 个方向开火，慢弹每 tick 飞 2 格织网、快弹飞 4 格点杀，弹速都严过机体满速。",
    "己方在飞弹幕最多 3 发；命中半径 1 格，不会伤到发射者本人。",
    "每架机体 100 点生命，先打到 0 点的一方落败；打满 600 tick 生命多者获胜。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "参赛人数", value: String(game.minPlayers) },
      { label: "战场尺寸", value: `${game.config.width}×${game.config.height}` },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
