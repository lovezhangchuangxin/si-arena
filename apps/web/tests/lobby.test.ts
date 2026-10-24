import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { paperGame } from "@si-arena/game-paper/game";
import { royaleGame } from "@si-arena/game-royale/game";
import { tetrisGame } from "@si-arena/game-tetris/game";
import LobbyPage from "../src/pages/LobbyPage.vue";
import { clearSession } from "../src/auth/session";

enableAutoUnmount(afterEach);
const games = [paperGame.manifest, royaleGame.manifest, tetrisGame.manifest];
beforeEach(() => {
  clearSession();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(catalog = games) {
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === "/api/games" ? { games: catalog } : { players: [], total: 0, page: 1, limit: 5 },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: {} },
      { path: "/games/:gameId", component: {} },
    ],
  });
  await router.push("/");
  const wrapper = mount(LobbyPage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router, fetch };
}

test("mode and text filters intersect, and an empty result can reset both", async () => {
  const { wrapper } = await setup();
  const titles = () => wrapper.findAll(".lobby-game-card h3").map((heading) => heading.text());
  const filter = (text: string) =>
    wrapper.findAll(".lobby-filters button").find((button) => button.text() === text)!;
  expect(titles()).toHaveLength(3);
  await filter("多人竞技场").trigger("click");
  expect(titles()).toEqual(["ROYALE圈地大逃杀"]);
  expect(filter("多人竞技场").attributes("aria-pressed")).toBe("true");
  await wrapper.get('input[type="search"]').setValue("PAPER");
  expect(titles()).toEqual([]);
  expect(wrapper.get(".lobby-empty").text()).toContain("没有找到匹配的游戏");
  await wrapper.get(".lobby-empty button").trigger("click");
  expect(titles()).toHaveLength(3);
  expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe("");
  await wrapper.get('input[type="search"]').setValue("  TeTRis  ");
  expect(titles()).toEqual(["TETRIS俄罗斯方块"]);
  await wrapper.get('input[type="search"]').setValue("");
  await filter("单人挑战").trigger("click");
  expect(titles()).toEqual(["TETRIS俄罗斯方块"]);
  await filter("双人对抗").trigger("click");
  expect(titles()).toEqual(["PAPER网格圈地"]);
});

test("entering a game only navigates and never creates a match or loads entry state", async () => {
  const { wrapper, router, fetch } = await setup();
  await wrapper.get('a[aria-label="进入圈地大逃杀"]').trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/games/royale");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/games",
    "/api/games/paper/leaderboard?page=1&limit=5",
  ]);
});

test("an empty catalog shows its own empty state without game cards", async () => {
  const { wrapper } = await setup([]);
  expect(wrapper.text()).toContain("暂时还没有可玩的游戏");
  expect(wrapper.find(".lobby-game-card").exists()).toBe(false);
});
