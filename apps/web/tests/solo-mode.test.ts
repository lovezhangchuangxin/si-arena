import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { tetrisGame } from "@si-arena/game-tetris/game";
import SoloModeCard from "../src/components/lobby/SoloModeCard.vue";
import { clearSession, signIn } from "../src/auth/session";
import type { GameCatalogEntry } from "@si-arena/protocol";

enableAutoUnmount(afterEach);

const game = tetrisGame.manifest as GameCatalogEntry;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const meEntry = {
  entry: {
    rank: 3,
    rating: 1000,
    bestScore: 1234,
    matchesPlayed: 5,
    wins: 0,
    draws: 0,
    losses: 0,
    placementTotal: 0,
    updatedAt: "2026-10-21T00:00:00.000Z",
  },
  boss: { available: false, attempts: 0, wins: 0 },
  canMatch: true,
  cannotMatchReason: null,
  code: null,
  activeMatch: null,
};

beforeEach(() => {
  clearSession();
});
afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("shows the personal best and starts a solo run on demand", async () => {
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/login")
      return response({
        user: { id: "me", username: "Me", official: false },
        token: "a".repeat(43),
      });
    if (url.endsWith("/me")) return response(meEntry);
    if (url.endsWith("/matches") && options?.method === "POST")
      return response(
        {
          id: "solo-run",
          gameId: game.id,
          kind: "solo",
          status: "pending",
          release: game.release,
          seed: 1,
          initiatorId: "me",
          createdAt: "2026-10-21T00:00:00.000Z",
          updatedAt: "2026-10-21T00:00:00.000Z",
          participants: [],
        },
        201,
      );
    return response({}, 404);
  });
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "me", "secret");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<p />" } }],
  });
  await router.push("/");
  const wrapper = mount(SoloModeCard, { props: { game }, global: { plugins: [router] } });
  await flushPromises();

  // The best score from /me renders once loaded.
  expect(wrapper.text()).toContain("1,234");
  const start = wrapper.findAll("button").find((button) => button.text() === "开始挑战");
  expect(start).toBeDefined();
  await start!.trigger("click");
  await flushPromises();
  const post = fetch.mock.calls.find(([url]) => url.endsWith("/matches"))!;
  expect(post[1]?.method).toBe("POST");
  // Solo runs are created with an empty matchmaking body: no opponent, no boss.
  expect(JSON.parse(String(post[1]?.body))).toEqual({});
  expect(router.currentRoute.value.fullPath).toBe(`/games/${game.id}?match=solo-run`);
});
