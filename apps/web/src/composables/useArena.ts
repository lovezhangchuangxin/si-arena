import type { GameCatalogEntry, MatchDetail } from "@si-arena/protocol";
import { ref, shallowRef, watch } from "vue";
import { ApiError, errorMessage } from "../api/client";
import { parseArenaStatus } from "../api/contracts";
import { useApiResource } from "./useApiResource";
import { useIdempotentPost } from "./useMatchRequest";

/** The single shared arena of a game: live status plus the idempotent start request. */
export function useArena(game: () => GameCatalogEntry | null | undefined) {
  const path = () => {
    const current = game();
    return current?.arena ? `/api/games/${encodeURIComponent(current.id)}/arena` : null;
  };
  const status = useApiResource(path, parseArenaStatus, {
    pollWhen: () => true,
    pollInterval: (value) => (value.active ? 3000 : 15000),
    notify: false,
  });
  const { post } = useIdempotentPost();
  const starting = ref(false);
  const error = ref("");
  const startedMatch = shallowRef<MatchDetail | null>(null);

  watch(path, () => {
    error.value = "";
    startedMatch.value = null;
  });

  async function start(): Promise<boolean> {
    const url = path();
    if (!url || starting.value) return false;
    error.value = "";
    starting.value = true;
    try {
      const run = await post(url, {});
      if (!run || path() !== url) return false;
      startedMatch.value = run;
      await status.reload();
      return path() === url;
    } catch (failure) {
      if (path() !== url) return false;
      // Someone else started a run first: show it as running instead of failing.
      if (!(failure instanceof ApiError && failure.code === "ARENA_BUSY"))
        error.value = errorMessage(failure);
      await status.reload();
      return false;
    } finally {
      starting.value = false;
    }
  }

  return { status, starting, error, start, startedMatch };
}
