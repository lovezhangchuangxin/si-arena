import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { paperGame } from "@si-arena/game-paper/game";
import { tetrisGame } from "@si-arena/game-tetris/game";
import LeaderboardPage from "../src/pages/LeaderboardPage.vue";
import { leaderboardBlurb } from "../src/games/leaderboard";
import { clearSession, signIn } from "../src/auth/session";

enableAutoUnmount(afterEach);
const game = paperGame.manifest;
const user = { id: "me", username: "Me", official: false };
const row = (rank: number, userId: string, username: string) => ({
  rank,
  userId,
  username,
  official: false,
  rating: 1100 - rank,
  matchesPlayed: 4,
  wins: 2,
  draws: 1,
  losses: 1,
  placementTotal: 0,
  bestScore: 0,
});
const board = {
  total: 2,
  page: 1,
  limit: 20,
  players: [row(1, "rival", "Rival"), row(2, "me", "Me")],
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let hidden = false;
beforeEach(() => {
  clearSession();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => {
  clearSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup() {
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/login") return response({ user, token: "a".repeat(43) });
    if (url.endsWith("/matches") && options?.method === "POST")
      return response(
        {
          id: "practice",
          gameId: "paper",
          kind: "practice",
          status: "pending",
          release: game.release,
          seed: 1,
          initiatorId: user.id,
          createdAt: "2026-10-21T00:00:00.000Z",
          updatedAt: "2026-10-21T00:00:00.000Z",
          participants: [],
        },
        201,
      );
    return response(board);
  });
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "me", "secret");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<p />" } }],
  });
  await router.push("/leaderboard");
  vi.useFakeTimers();
  const wrapper = mount(LeaderboardPage, { props: { game }, global: { plugins: [router] } });
  await flushPromises();
  const reads = () => fetch.mock.calls.filter(([url]) => url.includes("/leaderboard?")).length;
  return { wrapper, router, fetch, reads };
}

test("the board refreshes every 10 s while visible and right away when it becomes visible", async () => {
  const { wrapper, reads } = await setup();
  expect(reads()).toBe(1);
  await vi.advanceTimersByTimeAsync(9999);
  expect(reads()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(reads()).toBe(2);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(reads()).toBe(2);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
  expect(reads()).toBe(3);
  // The workspace refreshes the board as soon as the user's own match settles.
  await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
  expect(reads()).toBe(4);
});

test("other players can be challenged to a practice game, never yourself", async () => {
  const { wrapper, router, fetch } = await setup();
  const challenges = wrapper.findAll("button").filter((b) => b.text() === "挑战");
  expect(challenges).toHaveLength(1);
  expect(challenges[0]!.attributes("aria-label")).toBe("挑战 Rival");
  await challenges[0]!.trigger("click");
  await flushPromises();
  const post = fetch.mock.calls.find(([url]) => url.endsWith("/matches"))!;
  expect(post[1]?.method).toBe("POST");
  expect(post[1]?.body).toBe('{"opponentId":"rival"}');
  expect(new Headers(post[1]?.headers).get("Idempotency-Key")).toBeTruthy();
  expect(router.currentRoute.value.fullPath).toBe("/games/paper?match=practice");
});

test("solo boards explain best-score ordering and never offer challenges", async () => {
  // The blurb derives the ordering from the manifest alone.
  expect(leaderboardBlurb(tetrisGame.manifest)).toContain("单人最高得分");

  const solo = {
    total: 2,
    page: 1,
    limit: 20,
    players: [
      { ...row(1, "rival", "Rival"), bestScore: 900 },
      { ...row(2, "me", "Me"), bestScore: 120 },
    ],
  };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/login") return response({ user, token: "a".repeat(43) });
    if (url.endsWith("/matches") && options?.method === "POST") return response({}, 201);
    return response(solo);
  });
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "me", "secret");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<p />" } }],
  });
  await router.push("/leaderboard");
  const wrapper = mount(LeaderboardPage, {
    props: { game: tetrisGame.manifest },
    global: { plugins: [router] },
  });
  await flushPromises();

  // No challenge buttons exist on a solo board, only the best-score column.
  expect(wrapper.findAll("button").filter((b) => b.text() === "挑战")).toHaveLength(0);
  expect(wrapper.text()).toContain("最高分");
  expect(wrapper.text()).toContain("900");
});

test("arena boards rank by rating and show championships and the average place", async () => {
  const arenaBoard = {
    ...board,
    players: [
      { ...row(1, "rival", "Rival"), rating: 1016, wins: 1, matchesPlayed: 2, placementTotal: 3 },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(arenaBoard)),
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<p />" } }],
  });
  await router.push("/leaderboard");
  const arena = { seats: 5, keepMatches: 3 };
  const wrapper = mount(LeaderboardPage, {
    props: { game: { ...game, id: "royale", arena } },
    global: { plugins: [router] },
  });
  await flushPromises();
  expect(wrapper.get("thead").text()).toContain("排位分");
  expect(wrapper.get("tbody").text()).toContain("2 场 · 1 冠 · 平均第 1.5 名");
  expect(wrapper.get("tbody").text()).toContain("1016.00");
  expect(wrapper.text()).not.toContain("挑战");
});
