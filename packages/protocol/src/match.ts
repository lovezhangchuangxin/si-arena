import type { GameResult } from "./game";
import type { JsonObject } from "./json";
import type { ResourceLimits } from "./resources";

export type MatchStatus = "pending" | "running" | "completed" | "failed";

/**
 * How a match was created and how it settles:
 * - ranked: matchmaking against another player; both ratings change.
 * - practice: a chosen opponent or the official fallback; no rating change.
 * - boss: a challenge against the platform boss; no rating change.
 * - arena: a run of a game's shared arena; scored with pairwise Elo.
 * - solo: a single-player run; the game entry keeps the best score.
 */
export const MATCH_KINDS = ["ranked", "practice", "boss", "arena", "solo"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

/**
 * Controlled failure reasons for failed matches, written by the worker and
 * surfaced verbatim in match details.
 */
export const MATCH_FAILURE_REASONS = [
  "ENTRY_CHANGED_BEFORE_START",
  "WORKER_LOST",
  "EXECUTION_FAILED",
] as const;

export type MatchFailureReason = (typeof MATCH_FAILURE_REASONS)[number];

/** Why an otherwise authenticated user cannot initiate a match for a game right now. */
export type CannotMatchReason = "NO_CODE" | "PROTOCOL_MISMATCH" | "CODE_TOO_LARGE";

export const MATCH_PAGE_LIMIT_MIN = 1;
export const MATCH_PAGE_LIMIT_DEFAULT = 50;
export const MATCH_PAGE_LIMIT_MAX = 100;

export interface MatchParticipantSummary {
  userId: string;
  username: string;
  official: boolean;
  boss: boolean;
  slot: number;
  rank?: number;
  /** In-game score from the settled result, written at settlement time. */
  score?: number;
  ratingBefore?: number;
  ratingAfter?: number;
}

export interface MatchSummary {
  id: string;
  gameId: string;
  kind: MatchKind;
  status: MatchStatus;
  createdAt: string;
  participants: MatchParticipantSummary[];
}

export interface MatchDetail extends MatchSummary {
  release: string;
  seed: number;
  initiatorId: string;
  result?: GameResult;
  failureReason?: MatchFailureReason;
  updatedAt: string;
}

export interface GameCodeInfo {
  source: string;
  sourceBytes: number;
  botProtocolVersion: number;
  updatedAt: string;
}

export interface GameEntryStats {
  /** Leaderboard rank; null when the user has no entry or is a system account. */
  rank: number | null;
  rating: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  /** Arena games: the sum of finishing ranks, for the average placement. */
  placementTotal: number;
  /** Solo games: the best score achieved across finished runs. */
  bestScore: number;
}

export interface BossRecord {
  /** False when the server has no boss installed for this game. */
  available: boolean;
  attempts: number;
  wins: number;
}

export interface GameMeResponse {
  entry: GameEntryStats;
  boss: BossRecord;
  code: GameCodeInfo | null;
  canMatch: boolean;
  cannotMatchReason: CannotMatchReason | null;
  /** Only the user's unfinished initiated request; passive participations do not block matching. */
  activeMatch: { id: string; status: "pending" | "running" } | null;
}

export interface LeaderboardPlayer {
  rank: number;
  userId: string;
  username: string;
  official: boolean;
  rating: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  /** Arena games: the sum of finishing ranks, for the average placement. */
  placementTotal: number;
  /** Solo games: the best score achieved across finished runs. */
  bestScore: number;
}

export interface LeaderboardResponse {
  total: number;
  page: number;
  limit: number;
  players: LeaderboardPlayer[];
}

/** Body of POST /api/games/:gameId/matches; omit both fields for ranked matchmaking. */
export interface CreateMatchRequest {
  /** Practice against this player. */
  opponentId?: string;
  /** Challenge the platform boss. */
  boss?: true;
}

export interface ArenaLineupEntry {
  userId: string;
  username: string;
  official: boolean;
  rating: number;
  wins: number;
  matchesPlayed: number;
  codeUpdatedAt: string;
}

/** GET /api/games/:gameId/arena for games whose manifest declares an arena. */
export interface ArenaStatusResponse {
  /** The single unfinished arena run, if any; starting another is refused meanwhile. */
  active: MatchDetail | null;
  /** Who would enter if the arena started now, in seat order. */
  lineup: ArenaLineupEntry[];
  /** Completed or failed runs still kept, newest first. */
  recent: MatchDetail[];
}

export interface PaginatedMatchesResponse {
  total: number;
  page: number;
  limit: number;
  matches: MatchDetail[];
}

/** Frozen at match creation; the worker never re-resolves current releases. */
export interface FrozenGameRelease {
  gameId: string;
  release: string;
  config: JsonObject;
  resolvedLimits: ResourceLimits;
  botProtocolVersion: number;
}

/** Upper bound keeps (page - 1) * limit far inside PostgreSQL's offset range. */
export const MATCH_PAGE_MAX = 1_000_000;

export function clampMatchPageLimit(value: number): number {
  if (!Number.isFinite(value)) return MATCH_PAGE_LIMIT_DEFAULT;
  return Math.min(MATCH_PAGE_LIMIT_MAX, Math.max(MATCH_PAGE_LIMIT_MIN, Math.round(value)));
}

export function clampMatchPage(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MATCH_PAGE_MAX, Math.max(1, Math.round(value)));
}
