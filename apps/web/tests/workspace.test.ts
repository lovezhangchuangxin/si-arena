import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { paperGame } from "@si-arena/game-paper/game";
import type { ArenaStatusResponse, GameMeResponse, MatchDetail } from "@si-arena/protocol";
import GameLayout from "../src/pages/GameLayout.vue";
import GamePage from "../src/pages/GamePage.vue";
import MatchPage from "../src/pages/MatchPage.vue";
import GameMatch from "../src/components/GameMatch.vue";
import GameEntry from "../src/components/GameEntry.vue";
import HistoryPage from "../src/pages/HistoryPage.vue";
import LeaderboardPage from "../src/pages/LeaderboardPage.vue";
import ReplayViewer from "../src/components/ReplayViewer.vue";
import * as browserReplay from "@si-arena/player/browser";
import { replayFixture } from "./replay-fixture";
import { clearSession, signIn } from "../src/auth/session";

enableAutoUnmount(afterEach);
const user = { id: "player", username: "Player", official: false };
const date = "2026-10-20T00:00:00.000Z";
const initial: GameMeResponse = {
  entry: {
    rank: null,
    rating: 1000,
    matchesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    placementTotal: 0,
    bestScore: 0,
  },
  boss: { available: false, attempts: 0, wins: 0 },
  code: {
    source: "export default () => ({})",
    sourceBytes: 24,
    botProtocolVersion: paperGame.manifest.botProtocolVersion,
    updatedAt: date,
  },
  canMatch: true,
  cannotMatchReason: null,
  activeMatch: null,
};
function match(id: string, status: MatchDetail["status"] = "pending"): MatchDetail {
  return {
    id,
    status,
    kind: "ranked",
    gameId: "paper",
    release: paperGame.manifest.release,
    seed: 1,
    initiatorId: user.id,
    createdAt: date,
    updatedAt: date,
    participants: [
      { userId: user.id, username: user.username, official: false, boss: false, slot: 0 },
    ],
  };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  clearSession();
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup(url = "/games/paper", me = initial, arenaStatus?: ArenaStatusResponse) {
  let current = { ...me };
  const matches = new Map([
    ["first", match("first")],
    ["second", match("second", "failed")],
  ]);
  const fetch = vi.fn(async (input: string, options?: RequestInit) => {
    if (input === "/api/auth/login") return response({ user, token: "a".repeat(43) });
    if (input === "/api/games/paper")
      return response(
        arenaStatus
          ? { ...paperGame.manifest, arena: { seats: 2, keepMatches: 3 } }
          : paperGame.manifest,
      );
    if (input === "/api/games/paper/arena" && arenaStatus) return response(arenaStatus);
    if (input === "/api/games/paper/me") return response(current);
    if (input.startsWith("/api/games/paper/me/matches?"))
      return response({ matches: [...matches.values()], total: 2, page: 1, limit: 5 });
    if (input.startsWith("/api/games/paper/leaderboard?"))
      return response({ players: [], total: 0, page: 1, limit: 20 });
    if (input === "/api/games/paper/matches" && options?.method === "POST") {
      current = { ...current, activeMatch: { id: "first", status: "pending" } };
      return response(matches.get("first"));
    }
    const value = matches.get(input.replace("/api/matches/", ""));
    return value ? response(value) : response({ message: "比赛不存在" }, 404);
  });
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "player", "secret");
  fetch.mockClear();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/:pathMatch(.*)*", component: {} },
      { path: "/matches/:matchId", component: MatchPage },
      {
        path: "/games/:gameId",
        component: GameLayout,
        children: [
          { path: "", component: GamePage },
          { path: "matches", component: HistoryPage },
          { path: "leaderboard", component: LeaderboardPage },
          { path: "rules", component: { template: "<p>规则正文</p>" } },
        ],
      },
    ],
  });
  await router.push(url);
  const wrapper = mount(RouterView, { global: { plugins: [router] } });
  await flushPromises();
  return {
    wrapper,
    router,
    fetch,
    matches,
    updateArena: (value: ArenaStatusResponse) => {
      arenaStatus = value;
    },
    updateMe: (value: GameMeResponse) => {
      current = value;
    },
  };
}

test("matching opens inline, preserves the upload component and refreshes entry stats on settlement", async () => {
  const { wrapper, router, fetch, matches, updateMe } = await setup();
  vi.useFakeTimers();
  const entry = wrapper.get("input[type=file]").element;
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "发起匹配")!
    .trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/games/paper?match=first");
  expect(wrapper.get("input[type=file]").element).toBe(entry);
  expect(wrapper.getComponent(GameMatch).text()).toContain("等待开局");
  expect(wrapper.text()).toContain("查看当前比赛");
  await wrapper.get("#game-tab-matches").trigger("click");
  await flushPromises();
  matches.set("first", match("first", "failed"));
  updateMe({ ...initial, entry: { ...initial.entry, rating: 1012, matchesPlayed: 1 } });
  window.dispatchEvent(new Event("focus"));
  await flushPromises();
  await vi.advanceTimersByTimeAsync(1000);
  await flushPromises();
  expect(wrapper.getComponent(GameMatch).text()).toContain("比赛失败");
  expect(wrapper.getComponent(GameEntry).text()).toContain("1012.00");
  expect(wrapper.get('#game-panel-matches a[href="/games/paper?match=first"]').text()).toContain(
    "系统失败",
  );
  expect(wrapper.text()).toContain("发起匹配");
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});

test("opening history switches inline and navigation restores the selected match", async () => {
  const { wrapper, router } = await setup("/games/paper?match=first");
  const entry = wrapper.get("input[type=file]").element;
  const stage = wrapper.getComponent(GameMatch).element;
  await wrapper.get("#game-tab-matches").trigger("click");
  await flushPromises();
  expect(wrapper.getComponent(GameMatch).element).toBe(stage);
  await wrapper.get('a[href="/games/paper?match=second"]').trigger("click");
  await flushPromises();
  expect(wrapper.getComponent(GameMatch).text()).toContain("比赛失败");
  expect(wrapper.get("input[type=file]").element).toBe(entry);
  await wrapper.get("#game-tab-play").trigger("click");
  await flushPromises();
  expect(wrapper.get("#game-panel-play").isVisible()).toBe(true);
  expect(wrapper.text()).toContain(initial.code!.source);
  await wrapper.get("#game-tab-match").trigger("click");
  await flushPromises();
  expect(wrapper.getComponent(GameMatch).props("matchId")).toBe("second");
  await wrapper.getComponent(GameMatch).get('a[href="/games/paper"]').trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.query.match).toBeUndefined();
  expect(wrapper.findComponent(GameMatch).exists()).toBe(false);
});

test("the initial scene and sidebar navigation never create a match", async () => {
  const { wrapper, fetch } = await setup();
  const canvas = wrapper.get("canvas").element;
  const upload = wrapper.get("input[type=file]").element;
  expect(wrapper.get("canvas").attributes("aria-label")).toContain("静态初始画面");
  await wrapper.get("#game-tab-leaderboard").trigger("click");
  await flushPromises();
  expect(wrapper.get("canvas").element).toBe(canvas);
  expect(wrapper.get("input[type=file]").element).toBe(upload);
  expect(wrapper.get("#game-tab-leaderboard").attributes("aria-selected")).toBe("true");
  expect(fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});

test("a match settling during an upload refreshes the entry after the upload finishes", async () => {
  const { wrapper, matches, fetch, updateMe } = await setup();
  vi.useFakeTimers();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "发起匹配")!
    .trigger("click");
  await flushPromises();
  let finishUpload: ((value: Response) => void) | undefined;
  const normal = fetch.getMockImplementation()!;
  fetch.mockImplementation((input, options) => {
    if (options?.method === "PUT")
      return new Promise<Response>((resolve) => {
        finishUpload = resolve;
      });
    return normal(input, options);
  });
  const input = wrapper.get("input[type=file]");
  Object.defineProperty(input.element, "files", {
    value: [
      {
        name: "bot.js",
        size: initial.code!.source.length,
        arrayBuffer: async () => new TextEncoder().encode(initial.code!.source).buffer,
      },
    ],
  });
  await input.trigger("change");
  await flushPromises();
  matches.set("first", match("first", "failed"));
  updateMe({ ...initial, entry: { ...initial.entry, rating: 1012 } });
  await vi.advanceTimersByTimeAsync(1000);
  await flushPromises();
  expect(wrapper.getComponent(GameEntry).text()).toContain("上传并校验中");
  finishUpload!(response(initial.code));
  await flushPromises();
  expect(wrapper.getComponent(GameEntry).text()).toContain("1012.00");
  expect(wrapper.getComponent(GameEntry).text()).toContain("发起匹配");
  expect(wrapper.getComponent(GameEntry).text()).not.toContain("查看当前比赛");
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});

test("an old rules link opens gameplay while retaining the selected match", async () => {
  const { wrapper } = await setup("/games/paper/rules?match=first");
  expect(wrapper.get("#game-panel-play").isVisible()).toBe(true);
  expect(wrapper.get("#game-tab-play").attributes("aria-selected")).toBe("true");
  expect(wrapper.getComponent(GameMatch).props("matchId")).toBe("first");
});

test("switching sidebar tabs preserves the loaded replay and its current tick", async () => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { wrapper, router, matches, fetch } = await setup();
  const raw = await replayFixture();
  vi.spyOn(browserReplay, "readBrowserReplay").mockResolvedValue(raw);
  matches.set(raw.matchId, { ...match(raw.matchId, "completed"), result: raw.result });
  const normal = fetch.getMockImplementation()!;
  fetch.mockImplementation((input, options) =>
    input.endsWith("/replay")
      ? Promise.resolve(new Response("gzip fixture"))
      : normal(input, options),
  );
  await router.push(`/games/paper?match=${raw.matchId}`);
  await flushPromises();
  // A Paper replay always runs to the tick limit, so loading it validates
  // every tick and needs more than the default wait.
  await vi.waitFor(() => expect(wrapper.findComponent(ReplayViewer).exists()).toBe(true), {
    timeout: 10000,
  });
  const canvas = wrapper.getComponent(ReplayViewer).get("canvas").element;
  await wrapper.getComponent(ReplayViewer).get('[aria-label="前进一个 tick"]').trigger("click");
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 1");
  expect(wrapper.get("#game-panel-match").text()).toContain("Tick 诊断");
  await wrapper.get("#game-tab-leaderboard").trigger("click");
  await flushPromises();
  expect(wrapper.getComponent(ReplayViewer).get("canvas").element).toBe(canvas);
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 1");
  await wrapper.get("#game-tab-match").trigger("click");
  await flushPromises();
  expect(wrapper.get("#game-panel-match").text()).toContain("执行 tick 0 → 世界 S1");
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/replay"))).toHaveLength(1);
  // Loading a Paper replay validates every tick of the match.
}, 20000);

test("reload recovers an active request without replacing an explicitly selected historical match", async () => {
  const me = { ...initial, activeMatch: { id: "first", status: "pending" as const } };
  const recovered = await setup("/games/paper", me);
  expect(recovered.router.currentRoute.value.query.match).toBe("first");
  expect(recovered.wrapper.getComponent(GameMatch).text()).toContain("等待开局");
  expect(recovered.fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  recovered.wrapper.unmount();
  const historical = await setup("/games/paper?match=second", me);
  expect(historical.router.currentRoute.value.query.match).toBe("second");
  expect(historical.wrapper.getComponent(GameMatch).text()).toContain("比赛失败");
});

test("legacy links resolve into the workspace, with retry for missing matches", async () => {
  const { wrapper, router, matches, fetch } = await setup("/matches/missing");
  expect(wrapper.text()).toContain("比赛不存在");
  matches.set("missing", match("missing", "failed"));
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "重新加载")!
    .trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/games/paper?match=missing");
  expect(wrapper.getComponent(GameMatch).text()).toContain("比赛失败");
  expect(fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});

test("a match for another game is rejected without showing its result or downloading a replay", async () => {
  const { wrapper, router, matches, fetch } = await setup();
  matches.set("foreign", { ...match("foreign", "failed"), gameId: "another" });
  await router.push("/games/paper?match=foreign");
  await flushPromises();
  expect(wrapper.getComponent(GameMatch).text()).toContain("比赛与当前游戏不匹配");
  expect(wrapper.getComponent(GameMatch).text()).not.toContain("比赛失败");
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/replay"))).toBe(false);
});

test("switching the selected match cancels an unfinished replay download", async () => {
  const { wrapper, router, matches, fetch } = await setup();
  matches.set("first", {
    ...match("first", "completed"),
    result: {
      reason: "finished",
      completedTicks: 1,
      players: [{ id: user.id, rank: 1, score: 1 }],
    },
  });
  const normal = fetch.getMockImplementation()!;
  let finishReplay: ((value: Response) => void) | undefined;
  let replaySignal: AbortSignal | null | undefined;
  fetch.mockImplementation((input, options) => {
    if (input.endsWith("/replay")) {
      replaySignal = options?.signal;
      return new Promise<Response>((resolve) => {
        finishReplay = resolve;
      });
    }
    return normal(input, options);
  });
  await router.push("/games/paper?match=first");
  await flushPromises();
  expect(wrapper.getComponent(GameMatch).text()).toContain("正在下载并校验回放");
  expect(replaySignal?.aborted).toBe(false);
  await router.push("/games/paper?match=second");
  await flushPromises();
  expect(replaySignal?.aborted).toBe(true);
  finishReplay!(new Response("obsolete replay"));
  await flushPromises();
  expect(wrapper.getComponent(GameMatch).props("matchId")).toBe("second");
  expect(wrapper.getComponent(GameMatch).text()).toContain("比赛失败");
  expect(wrapper.getComponent(GameMatch).text()).not.toContain("回放");
});

test("background arena settlements refresh stats without changing the loaded replay", async () => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { wrapper, router, matches, fetch, updateArena, updateMe } = await setup(
    "/games/paper",
    initial,
    { active: null, lineup: [], recent: [] },
  );
  const raw = await replayFixture();
  vi.spyOn(browserReplay, "readBrowserReplay").mockResolvedValue(raw);
  matches.set(raw.matchId, { ...match(raw.matchId, "completed"), result: raw.result });
  const normal = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, options) =>
    url.endsWith("/replay") ? Promise.resolve(new Response("gzip fixture")) : normal(url, options),
  );
  await router.push(`/games/paper?match=${raw.matchId}`);
  await flushPromises();
  await vi.waitFor(() => expect(wrapper.findComponent(ReplayViewer).exists()).toBe(true), {
    timeout: 10000,
  });
  const viewer = wrapper.getComponent(ReplayViewer);
  const canvas = viewer.get("canvas").element;
  const session = viewer.props("session");
  await viewer.get('[aria-label="前进一个 tick"]').trigger("click");
  await viewer.get('[role="combobox"][aria-label="播放速度"]').trigger("click");
  await viewer.get('[role="option"][data-value="2"]').trigger("click");
  await viewer
    .findAll("button")
    .find((button) => button.text() === "播放")!
    .trigger("click");
  vi.useFakeTimers();
  // Resume polling with the fake clock, leaving the loaded player's clock untouched.
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
  const replayReads = () => fetch.mock.calls.filter(([url]) => url.endsWith("/replay")).length;
  const before = replayReads();
  updateArena({
    active: { ...match("other-run", "running"), kind: "arena" },
    lineup: [],
    recent: [],
  });
  await vi.advanceTimersByTimeAsync(15000);
  await flushPromises();
  updateMe({ ...initial, entry: { ...initial.entry, rating: 1032, matchesPlayed: 3 } });
  updateArena({
    active: null,
    lineup: [],
    // Even when newer retained matches exclude the viewed match, keep its cached replay.
    recent: [0, 1, 2].map((i) => ({
      ...match(`new-${i}`, "completed"),
      kind: "arena",
      result: raw.result,
    })),
  });
  await vi.advanceTimersByTimeAsync(3000);
  await flushPromises();
  expect(wrapper.getComponent(GameEntry).text()).toContain("1032.00");
  expect(router.currentRoute.value.query.match).toBe(raw.matchId);
  expect(wrapper.getComponent(ReplayViewer).get("canvas").element).toBe(canvas);
  expect(wrapper.getComponent(ReplayViewer).props("session")).toBe(session);
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 1");
  expect(viewer.get('[role="combobox"][aria-label="播放速度"]').text()).toContain("2×");
  expect(viewer.findAll("button").some((button) => button.text() === "暂停")).toBe(true);
  expect(replayReads()).toBe(before);
}, 20000);
