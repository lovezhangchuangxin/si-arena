import type { MatchKind, MatchParticipantSummary, MatchSummary } from "@si-arena/protocol";

export function ratingDelta(player: MatchParticipantSummary | undefined): string {
  if (player?.ratingBefore === undefined || player.ratingAfter === undefined) return "—";
  const value = Math.round((player.ratingAfter - player.ratingBefore) * 100) / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

const kindLabels: Record<MatchKind, string | undefined> = {
  ranked: undefined,
  practice: "练习",
  boss: "Boss",
  arena: "竞技场",
  solo: "单人",
};

/** Badge text for matches that are not ordinary ranked games. */
export function kindLabel(kind: MatchKind): string | undefined {
  return kindLabels[kind];
}

/** Practice and boss games never move ratings; system failures never score. */
export function isUnscored(match: MatchSummary): boolean {
  return match.status === "failed" || match.kind === "practice" || match.kind === "boss";
}

/** How the match changed the viewer's standing: rating delta, arena place, solo score or 不计分. */
export function standingChange(match: MatchSummary, userId?: string): string {
  if (isUnscored(match)) return "不计分";
  const self = match.participants.find((p) => p.userId === userId);
  if (match.kind === "arena")
    return match.status === "completed" && self?.rank !== undefined ? `第 ${self.rank} 名` : "—";
  if (match.kind === "solo")
    return match.status === "completed" && self?.score !== undefined
      ? `${self.score.toLocaleString()} 分`
      : "—";
  return ratingDelta(self);
}

export function matchOutcome(match: MatchSummary, userId?: string) {
  if (match.status === "pending") return { label: "等待开局", tone: "warning" } as const;
  if (match.status === "running") return { label: "进行中", tone: "accent" } as const;
  if (match.status === "failed") return { label: "系统失败", tone: "danger" } as const;
  const self = match.participants.find((p) => p.userId === userId);
  if (match.kind === "solo")
    return {
      label: self?.score !== undefined ? `${self.score.toLocaleString()} 分` : "完赛",
      tone: "accent",
    } as const;
  const ranks = match.participants.map((p) => p.rank);
  if (self?.rank === undefined || ranks.some((rank) => rank === undefined))
    return { label: "已完成", tone: "neutral" } as const;
  const best = Math.min(...(ranks as number[]));
  if (ranks.every((rank) => rank === self.rank)) return { label: "平局", tone: "neutral" } as const;
  if (self.rank === best) return { label: "获胜", tone: "success" } as const;
  return {
    label: match.participants.length === 2 ? "失利" : `第 ${self.rank} 名`,
    tone: "danger",
  } as const;
}
