import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { paperGame } from "@si-arena/game-paper/game";
import type { ArenaStatusResponse, MatchDetail } from "@si-arena/protocol";
import GameLayout from "../src/pages/GameLayout.vue";
import GamePage from "../src/pages/GamePage.vue";
import HistoryPage from "../src/pages/HistoryPage.vue";
import GameDevelopment from "../src/components/GameDevelopment.vue";
import GameMatch from "../src/components/GameMatch.vue";
import { royaleGame } from "@si-arena/game-royale/game";
import { snakeGame } from "@si-arena/game-snake/game";
import { bomberGame } from "@si-arena/game-bomber/game";
import type { GameCatalogEntry } from "@si-arena/protocol";
import { clearSession, signIn } from "../src/auth/session";

enableAutoUnmount(afterEach);
const user = { id: "me", username: "Me", official: false };
const arena = { seats: 5, keepMatches: 3 };
const royale = {
  ...paperGame.manifest,
  id: "royale",
  name: "圈地大逃杀",
  // Not a registered release, so the page must list runs without downloading them.
  release: "royale@0.0.0-unregistered",
  arena,
};
const date = "2026-10-21T00:00:00.000Z";
function run(id: string, status: MatchDetail["status"]): MatchDetail {
  return {
    id,
    gameId: "royale",
    kind: "arena",
    status,
    release: royale.release,
    seed: 1,
    initiatorId: "a",
    createdAt: date,
    updatedAt: date,
    participants: ["a", "b"].map((name, slot) => ({
      userId: name,
      username: name.toUpperCase(),
      official: false,
      boss: false,
      slot,
      ...(status === "completed" ? { rank: slot + 1 } : {}),
    })),
    ...(status === "completed"
      ? {
          result: {
            reason: "last-alive",
            completedTicks: 300,
            players: [
              { id: "a", rank: 1, score: 40 },
              { id: "b", rank: 2, score: 0 },
            ],
          },
        }
      : {}),
  };
}
const lineup = ["a", "b"].map((name) => ({
  userId: name,
  username: name.toUpperCase(),
  official: false,
  rating: 1016,
  wins: 1,
  matchesPlayed: 2,
  codeUpdatedAt: date,
}));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  clearSession();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  clearSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(game: GameCatalogEntry = royale) {
  let status: ArenaStatusResponse = { active: null, lineup, recent: [run("done", "completed")] };
  const me = {
    entry: {
      rank: 1,
      rating: 1016,
      bestScore: 0,
      matchesPlayed: 2,
      wins: 1,
      draws: 0,
      losses: 0,
      placementTotal: 3,
    },
    code: {
      source: "export default () => {}",
      sourceBytes: 22,
      updatedAt: date,
      botProtocolVersion: game.botProtocolVersion,
    },
    canMatch: true,
    cannotMatchReason: null,
    activeMatch: null,
    boss: { available: false, attempts: 0, wins: 0 },
  };
  let busy = true;
  const live = { ...run("live", "running"), gameId: game.id, release: game.release };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/login") return response({ user, token: "a".repeat(43) });
    if (url === `/api/games/${game.id}`) return response(game);
    if (url === `/api/games/${game.id}/me`) return response(me);
    if (url.startsWith(`/api/games/${game.id}/me/matches?`))
      return response({ matches: status.recent, total: status.recent.length, page: 1, limit: 20 });
    if (url === `/api/games/${game.id}/arena` && options?.method === "POST") {
      status = { ...status, active: live };
      return busy
        ? response({ code: "ARENA_BUSY", message: "竞技场正在运行", matchId: "live" }, 409)
        : response(live, 201);
    }
    if (url === `/api/games/${game.id}/arena`) return response(status);
    if (url === "/api/matches/live") return response(live);
    if (url === "/api/matches/done") return response(run("done", "completed"));
    if (url.endsWith("/development"))
      return response({
        prompt: "提示词",
        sdk: "SDK",
        officialBot: "export default () => {}",
        template: "export default () => {}",
      });
    return response({ message: "不存在" }, 404);
  });
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "me", "secret");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/:pathMatch(.*)*", component: {} },
      {
        path: "/games/:gameId",
        component: GameLayout,
        children: [
          { path: "", component: GamePage },
          { path: "development", component: GameDevelopment },
          { path: "matches", component: HistoryPage },
        ],
      },
    ],
  });
  await router.push(`/games/${game.id}`);
  vi.useFakeTimers();
  const wrapper = mount(RouterView, { global: { plugins: [router] } });
  await flushPromises();
  const reads = () =>
    fetch.mock.calls.filter(
      ([url, options]) => url === `/api/games/${game.id}/arena` && options?.method !== "POST",
    ).length;
  return {
    wrapper,
    router,
    fetch,
    reads,
    me,
    updateArena: (value: ArenaStatusResponse) => {
      status = value;
    },
    succeed: () => {
      busy = false;
    },
    finish: () => {
      status = { ...status, active: null };
    },
  };
}

test("a busy arena shows the running run and prevents another start", async () => {
  const { wrapper, fetch, reads } = await setup();
  expect(wrapper.text()).toContain("竞技场空闲");
  expect(wrapper.text()).toContain("下一局阵容");
  expect(wrapper.text()).toContain("1016.00");
  expect(reads()).toBe(1);
  await vi.advanceTimersByTimeAsync(15000);
  expect(reads()).toBe(2);
  const start = wrapper.findAll("button").find((button) => button.text() === "开一局")!;
  expect(start.attributes("disabled")).toBeUndefined();
  await start.trigger("click");
  await flushPromises();
  expect(
    fetch.mock.calls.some(
      ([url, options]) =>
        url === "/api/games/royale/arena" &&
        options?.method === "POST" &&
        new Headers(options.headers).get("Idempotency-Key"),
    ),
  ).toBe(true);
  expect(wrapper.text()).toContain("正在运行");
  expect(wrapper.findAll("button").some((button) => button.text() === "开一局")).toBe(false);
  expect(wrapper.get(".game-actions a").text()).toBe("查看当前比赛");
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  const before = reads();
  await vi.advanceTimersByTimeAsync(3000);
  expect(reads()).toBe(before + 1);
});

test("arena history opens in the shared stage and keeps strategy actions mounted", async () => {
  const { wrapper, router, fetch } = await setup();
  const upload = wrapper.get('input[type="file"]').element;
  await wrapper.get('#game-panel-arena a[href="/games/royale?match=done"]').trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.query.match).toBe("done");
  expect(wrapper.getComponent(GameMatch).props("matchId")).toBe("done");
  expect(wrapper.text()).toContain("此发行的画面尚未注册");
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/replay"))).toBe(false);
  await wrapper.get("#game-tab-development").trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.query.match).toBe("done");
  expect(wrapper.getComponent(GameMatch).props("matchId")).toBe("done");
  expect(wrapper.get('input[type="file"]').element).toBe(upload);
  expect(wrapper.get("#game-panel-development").text()).toContain("复制 AI 安装提示词");
});

test.each([royaleGame.manifest, snakeGame.manifest, bomberGame.manifest])(
  "$id starts from the same workspace without visiting a separate arena page",
  async (game) => {
    const { wrapper, router, fetch, succeed } = await setup(game);
    succeed();
    expect(wrapper.get("#game-tab-arena").attributes("aria-selected")).toBe("true");
    expect(
      fetch.mock.calls.some(
        ([, options]) =>
          options?.method === "POST" && new Headers(options.headers).has("Idempotency-Key"),
      ),
    ).toBe(false);
    const upload = wrapper.get('input[type="file"]').element;
    await wrapper.get("#game-tab-play").trigger("click");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "开一局")!
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(`/games/${game.id}?match=live`);
    expect(wrapper.getComponent(GameMatch).props("matchId")).toBe("live");
    expect(wrapper.get('input[type="file"]').element).toBe(upload);
    expect(
      fetch.mock.calls.filter(
        ([, options]) =>
          options?.method === "POST" && new Headers(options.headers).has("Idempotency-Key"),
      ),
    ).toHaveLength(1);
  },
);

test("an uncertain arena upload blocks starting until the source is confirmed", async () => {
  const { wrapper, fetch, me } = await setup();
  const normal = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, options) =>
    options?.method === "PUT"
      ? Promise.reject(new TypeError("lost response"))
      : normal(url, options),
  );
  const input = wrapper.get('input[type="file"]');
  const source = "export default () => { /* updated */ }";
  Object.defineProperty(input.element, "files", {
    value: [
      {
        name: "bot.js",
        size: source.length,
        arrayBuffer: async () => new TextEncoder().encode(source).buffer,
      },
    ],
  });
  await input.trigger("change");
  await flushPromises();
  const start = wrapper.findAll("button").find((button) => button.text() === "开一局")!;
  expect(start.attributes("disabled")).toBeDefined();
  expect(wrapper.text()).toContain("上传结果待确认");
  expect(
    fetch.mock.calls.some(
      ([, options]) =>
        options?.method === "POST" && new Headers(options.headers).has("Idempotency-Key"),
    ),
  ).toBe(false);
  me.code.source = source;
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "核实状态")!
    .trigger("click");
  await flushPromises();
  expect(start.attributes("disabled")).toBeUndefined();
});

test("settlement refreshes personal stats while browsing other workspace tabs", async () => {
  const { wrapper, reads, me, finish } = await setup();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "开一局")!
    .trigger("click");
  await flushPromises();
  await wrapper.get("#game-tab-play").trigger("click");
  await flushPromises();
  me.entry.rating = 1032;
  finish();
  const before = reads();
  await vi.advanceTimersByTimeAsync(3000);
  await flushPromises();
  expect(reads()).toBe(before + 1);
  expect(wrapper.get(".game-actions").text()).toContain("1032.00");
  expect(wrapper.get(".game-actions").text()).toContain("开一局");
});

test("accepting an arena upload refreshes its lineup without starting a match", async () => {
  const { wrapper, fetch, reads, me } = await setup();
  const before = reads();
  const normal = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, options) =>
    options?.method === "PUT" ? Promise.resolve(response(me.code)) : normal(url, options),
  );
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [
      {
        name: "bot.js",
        size: me.code.source.length,
        arrayBuffer: async () => new TextEncoder().encode(me.code.source).buffer,
      },
    ],
  });
  await input.trigger("change");
  await flushPromises();
  expect(wrapper.text()).toContain("策略已更新");
  expect(reads()).toBe(before + 1);
  expect(
    fetch.mock.calls.some(
      ([, options]) =>
        options?.method === "POST" && new Headers(options.headers).has("Idempotency-Key"),
    ),
  ).toBe(false);
});

test.each(["next run already started", "finished between idle polls"])(
  "arena settlement refreshes stats and visible history when %s",
  async (scenario) => {
    const { wrapper, fetch, me, updateArena } = await setup();
    const first = run("first", "running");
    const recent = [run("done", "completed")];
    const running = scenario === "next run already started";
    if (running) {
      updateArena({ active: first, lineup, recent });
      await vi.advanceTimersByTimeAsync(15000);
      await flushPromises();
    }
    await wrapper.get("#game-tab-matches").trigger("click");
    await flushPromises();
    const entryReads = () =>
      fetch.mock.calls.filter(([url]) => url === "/api/games/royale/me").length;
    const before = entryReads();
    me.entry.rating = 1032;
    me.entry.matchesPlayed = 3;
    me.entry.wins = 2;
    updateArena({
      active: running ? run("next", "running") : null,
      lineup,
      recent: [run("first", "completed"), ...recent],
    });
    const interval = running ? 3000 : 15000;
    await vi.advanceTimersByTimeAsync(interval);
    await flushPromises();
    expect(entryReads()).toBe(before + 1);
    expect(wrapper.get(".game-actions").text()).toContain("1032.00");
    expect(wrapper.get(".game-actions").text()).toContain("已赛 3 场");
    expect(wrapper.get(".game-actions").text()).toContain("冠军 2 次");
    expect(wrapper.find('#game-panel-matches a[href="/games/royale?match=first"]').exists()).toBe(
      true,
    );
    // Identical poll results do not repeatedly refresh participation data.
    await vi.advanceTimersByTimeAsync(interval);
    await flushPromises();
    expect(entryReads()).toBe(before + 1);
    expect(
      fetch.mock.calls.some(
        ([url, options]) => url.startsWith("/api/games/") && options?.method === "POST",
      ),
    ).toBe(false);
  },
);
