import { and, eq, inArray } from "drizzle-orm";
import { gameEntries, matchParticipants } from "@si-arena/db";
import type { Executor } from "@si-arena/db";
import type { ProcessIsolation } from "@si-arena/runner";
import { failMatch, renewLease, RENEW_INTERVAL_MS, type ClaimedMatch } from "./claim";
import { findWorkerGame } from "./games";
import type { ReplayStore } from "./replay-store";
import { settleMatch } from "./settle";

const SETTLE_ATTEMPTS = 3;

export interface WorkerJobContext {
  db: Executor;
  store: ReplayStore;
  isolation: ProcessIsolation;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one claimed match end to end: snapshot both sources, execute under a
 * lease watchdog, then settle. Every terminal write re-checks execution rights.
 * Losing the lease (or shutting down) mid-match stops settlement and leaves the
 * row for the expiry sweep; a finished match still settles during shutdown.
 */
export async function runClaimedMatch(
  ctx: WorkerJobContext,
  claim: ClaimedMatch,
  shutdownSignal?: AbortSignal,
): Promise<void> {
  const game = findWorkerGame(claim.gameId, claim.release);
  if (game === null) {
    // Claiming is filtered by installed releases, so this is registry drift.
    throw new Error(`No installed game for ${claim.gameId}@${claim.release}`);
  }

  const seats = await ctx.db
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, claim.id))
    .orderBy(matchParticipants.slot);
  if (seats.length < 1 || seats.some((seat, index) => seat.slot !== index)) {
    await failMatch(ctx.db, {
      matchId: claim.id,
      executionId: claim.executionId,
      reason: "EXECUTION_FAILED",
    });
    throw new Error(`Match ${claim.id} does not have participants seated at slots 0..n-1`);
  }

  // One consistent snapshot for every player; uploads after this point only
  // affect future matches.
  const entries = await ctx.db
    .select()
    .from(gameEntries)
    .where(
      and(
        eq(gameEntries.gameId, claim.gameId),
        inArray(
          gameEntries.userId,
          seats.map((seat) => seat.userId),
        ),
      ),
    );
  const entryByUser = new Map(entries.map((entry) => [entry.userId, entry]));
  for (const seat of seats) {
    const entry = entryByUser.get(seat.userId);
    if (
      entry === undefined ||
      entry.botProtocolVersion !== claim.botProtocolVersion ||
      entry.sourceBytes > claim.resolvedLimits.codeBytes
    ) {
      await failMatch(ctx.db, {
        matchId: claim.id,
        executionId: claim.executionId,
        reason: "ENTRY_CHANGED_BEFORE_START",
      });
      return;
    }
  }

  const controller = new AbortController();
  let lostLease = false;
  const stopWatchdog = () => controller.abort();
  shutdownSignal?.addEventListener("abort", stopWatchdog, { once: true });
  const leaseTimer = setInterval(() => {
    void (async () => {
      try {
        if (!(await renewLease(ctx.db, claim.id, claim.executionId))) {
          lostLease = true;
          controller.abort();
        }
      } catch {
        lostLease = true;
        controller.abort();
      }
    })();
  }, RENEW_INTERVAL_MS);
  leaseTimer.unref();

  try {
    const candidatePath = ctx.store.candidatePath(claim.id, claim.executionId);
    const outcome = await game.run({
      matchId: claim.id,
      seed: claim.seed,
      config: claim.config,
      limits: claim.resolvedLimits,
      players: seats.map((seat) => ({
        id: seat.userId,
        slot: seat.slot,
        name: seat.nameSnapshot,
        official: seat.officialSnapshot,
      })),
      sources: seats.map((seat) => entryByUser.get(seat.userId)!.sourceCode),
      replayPath: candidatePath,
      isolation: ctx.isolation,
      signal: controller.signal,
    });
    if (lostLease) return;
    const replayFile = await ctx.store.inspect(candidatePath, claim.id);
    for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
      try {
        const settled = await settleMatch(ctx.db, ctx.store, {
          matchId: claim.id,
          executionId: claim.executionId,
          result: outcome.result,
          replayFile,
          candidatePath,
          ...(game.arena ? { arena: game.arena } : {}),
        });
        // Rows are gone once committed; a missed file is swept as an orphan later.
        await Promise.all(settled.prunedMatchIds.map((id) => ctx.store.remove(id))).catch(
          () => undefined,
        );
        return;
      } catch (error) {
        if (attempt === SETTLE_ATTEMPTS) throw error;
        await sleep(500 * attempt);
      }
    }
  } catch (error) {
    // Aborted runs (shutdown or lost lease) never reach a terminal write; the
    // expiry sweep owns the row. Anything else is a trusted-side failure.
    if (controller.signal.aborted) return;
    await failMatch(ctx.db, {
      matchId: claim.id,
      executionId: claim.executionId,
      reason: "EXECUTION_FAILED",
    }).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(leaseTimer);
    shutdownSignal?.removeEventListener("abort", stopWatchdog);
  }
}
