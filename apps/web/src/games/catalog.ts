import type { GameCatalogEntry } from "@si-arena/protocol";
import { isSoloGame } from "@si-arena/protocol";
import { inject, provide, type InjectionKey } from "vue";
import { parseGames } from "../api/contracts";
import { useApiResource, type ApiResource } from "../composables/useApiResource";

type Catalog = ApiResource<{ games: GameCatalogEntry[] }>;
const key: InjectionKey<Catalog> = Symbol("catalog");
const load = () => useApiResource(() => "/api/games", parseGames, { notify: false });

/** The app shell loads the catalog once; pages read the same resource. */
export function provideCatalog(): Catalog {
  const catalog = load();
  provide(key, catalog);
  return catalog;
}

/** Falls back to a page-local load when mounted outside the app shell. */
export function useCatalog(): Catalog {
  return inject(key, load, true);
}

/** Head-to-head games in catalog order: every game without an arena is matched 1v1. */
export const duelGames = (games: readonly GameCatalogEntry[] | undefined) =>
  games?.filter((game) => !game.arena && !isSoloGame(game)) ?? [];

/** Games whose manifest declares a shared arena, in catalog order. */
export const arenaGames = (games: readonly GameCatalogEntry[] | undefined) =>
  games?.filter((game) => game.arena) ?? [];

/** Single-player games ranked by best score, in catalog order. */
export const soloGames = (games: readonly GameCatalogEntry[] | undefined) =>
  games?.filter((game) => isSoloGame(game)) ?? [];
