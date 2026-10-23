import type { GameCatalogEntry } from "@si-arena/protocol";
import { isSoloGame } from "@si-arena/protocol";

/** One-line explanation of how a game's board is ordered, derived from its manifest. */
export function leaderboardBlurb(game: GameCatalogEntry): string {
  if (isSoloGame(game)) return "按单人最高得分实时排序。每次挑战独立开局，随时重跑刷新个人纪录。";
  if (!game.arena)
    return "按 Elo 排位分实时排序。练习、挑战与官方 bot 的比赛不计分，官方 bot 不上榜。";
  return "按 Elo 排位分实时排序。开局者必入场，其余席位按排位分从高到低递补；官方 bot 只补席，本身不参与计分。";
}
