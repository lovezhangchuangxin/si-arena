import type {
  ArenaStatusResponse,
  AuthTokenBody,
  AuthUserBody,
  GameCatalogEntry,
  GameCodeInfo,
  GameMeResponse,
  LeaderboardResponse,
  MatchDetail,
  MatchSummary,
  PaginatedMatchesResponse,
} from "@si-arena/protocol";
import { MATCH_FAILURE_REASONS, MATCH_KINDS, resolveResourceLimits } from "@si-arena/protocol";

function check(ok: unknown): asserts ok {
  if (!ok) throw new Error("服务器响应格式有误，请刷新后重试。");
}
export function record(raw: unknown): Record<string, unknown> {
  check(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  return raw as Record<string, unknown>;
}
function string(raw: unknown) {
  check(typeof raw === "string");
}
function number(raw: unknown) {
  check(typeof raw === "number" && Number.isFinite(raw));
}
function integer(raw: unknown) {
  number(raw);
  check(Number.isSafeInteger(raw) && (raw as number) >= 0);
}
function date(raw: unknown) {
  string(raw);
  check(Number.isFinite(Date.parse(raw as string)));
}
function user(raw: unknown) {
  const v = record(raw);
  string(v.id);
  string(v.username);
  check(typeof v.official === "boolean");
}
function boolean(raw: unknown) {
  check(typeof raw === "boolean");
}
function stats(raw: unknown) {
  const v = record(raw);
  number(v.rating);
  for (const k of ["matchesPlayed", "wins", "draws", "losses"]) integer(v[k]);
}
function page(raw: unknown) {
  const v = record(raw);
  integer(v.total);
  integer(v.page);
  integer(v.limit);
  check((v.page as number) > 0 && (v.limit as number) > 0);
  return v;
}
export function parseAuthUser(raw: unknown): AuthUserBody {
  user(record(raw).user);
  return raw as AuthUserBody;
}
export function parseAuthToken(raw: unknown): AuthTokenBody {
  parseAuthUser(raw);
  check(typeof record(raw).token === "string" && /^[\w-]{43}$/.test(record(raw).token as string));
  return raw as AuthTokenBody;
}
export function parseGame(raw: unknown): GameCatalogEntry {
  const v = record(raw);
  for (const k of ["id", "name", "description", "release"]) string(v[k]);
  for (const k of ["botProtocolVersion", "minPlayers", "maxPlayers", "maxTicks"]) integer(v[k]);
  record(v.config);
  if (v.arena !== undefined) {
    const arena = record(v.arena);
    integer(arena.seats);
    integer(arena.keepMatches);
    if (arena.tieBreakGameId !== undefined) string(arena.tieBreakGameId);
  }
  const resolvedLimits = resolveResourceLimits(record(v.resolvedLimits));
  return { ...(raw as GameCatalogEntry), resolvedLimits };
}
export function parseGames(raw: unknown) {
  const v = record(raw);
  check(Array.isArray(v.games));
  return { games: v.games.map(parseGame) };
}
export function parseUpload(raw: unknown): Omit<GameCodeInfo, "source"> {
  const v = record(raw);
  integer(v.sourceBytes);
  integer(v.botProtocolVersion);
  date(v.updatedAt);
  return raw as Omit<GameCodeInfo, "source">;
}
export function parseGameMe(raw: unknown): GameMeResponse {
  const v = record(raw);
  stats(v.entry);
  const entry = record(v.entry);
  check(entry.rank === null || (Number.isSafeInteger(entry.rank) && (entry.rank as number) > 0));
  integer(entry.placementTotal);
  integer(entry.bestScore);
  const boss = record(v.boss);
  boolean(boss.available);
  integer(boss.attempts);
  integer(boss.wins);
  boolean(v.canMatch);
  check(
    v.cannotMatchReason === null ||
      ["NO_CODE", "PROTOCOL_MISMATCH", "CODE_TOO_LARGE"].includes(String(v.cannotMatchReason)),
  );
  if (v.code !== null) {
    parseUpload(v.code);
    const code = record(v.code);
    string(code.source);
  }
  if (v.activeMatch !== null) {
    const active = record(v.activeMatch);
    string(active.id);
    check(active.status === "pending" || active.status === "running");
  }
  return raw as GameMeResponse;
}
function summary(raw: unknown): MatchSummary {
  const v = record(raw);
  string(v.id);
  string(v.gameId);
  date(v.createdAt);
  check(MATCH_KINDS.includes(v.kind as (typeof MATCH_KINDS)[number]));
  check(["pending", "running", "completed", "failed"].includes(String(v.status)));
  check(Array.isArray(v.participants));
  for (const rawPlayer of v.participants) {
    const p = record(rawPlayer);
    string(p.userId);
    string(p.username);
    boolean(p.official);
    boolean(p.boss);
    integer(p.slot);
    for (const k of ["rank", "score", "ratingBefore", "ratingAfter"])
      if (p[k] !== undefined) number(p[k]);
  }
  return raw as MatchSummary;
}
export function parseMatch(raw: unknown): MatchDetail {
  summary(raw);
  const v = record(raw);
  string(v.release);
  string(v.initiatorId);
  number(v.seed);
  date(v.updatedAt);
  if (v.failureReason !== undefined)
    check(
      MATCH_FAILURE_REASONS.includes(v.failureReason as (typeof MATCH_FAILURE_REASONS)[number]),
    );
  if (v.status === "completed") check(v.result !== undefined);
  if (v.result !== undefined) {
    const r = record(v.result);
    string(r.reason);
    integer(r.completedTicks);
    check(Array.isArray(r.players));
    for (const rawPlayer of r.players) {
      const p = record(rawPlayer);
      string(p.id);
      number(p.rank);
      number(p.score);
    }
  }
  return raw as MatchDetail;
}
export function parseHistory(raw: unknown): PaginatedMatchesResponse {
  const v = page(raw);
  check(Array.isArray(v.matches));
  v.matches.forEach(parseMatch);
  return raw as PaginatedMatchesResponse;
}
export function parseLeaderboard(raw: unknown): LeaderboardResponse {
  const v = page(raw);
  check(Array.isArray(v.players));
  for (const p of v.players) {
    user({ ...record(p), id: record(p).userId });
    stats(p);
    for (const k of ["rank", "placementTotal", "bestScore"]) integer(record(p)[k]);
  }
  return raw as LeaderboardResponse;
}
export function parseArenaStatus(raw: unknown): ArenaStatusResponse {
  const v = record(raw);
  if (v.active !== null) parseMatch(v.active);
  check(Array.isArray(v.lineup) && Array.isArray(v.recent));
  for (const entry of v.lineup) {
    const p = record(entry);
    user({ ...p, id: p.userId });
    number(p.rating);
    for (const k of ["wins", "matchesPlayed"]) integer(p[k]);
    date(p.codeUpdatedAt);
  }
  v.recent.forEach(parseMatch);
  return raw as ArenaStatusResponse;
}
