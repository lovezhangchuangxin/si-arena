import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { paperGame } from "@si-arena/game-paper/game";
import App from "../src/App.vue";
import NotFoundPage from "../src/pages/NotFoundPage.vue";

enableAutoUnmount(afterEach);
const arena = { seats: 5, keepMatches: 3 };
const royale = { ...paperGame.manifest, id: "royale", name: "圈地大逃杀", arena };
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ games: [paperGame.manifest, royale] }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

test("an unknown route can return to the lobby through the rendered navigation link", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => h("h1", "游戏大厅") } },
      { path: "/:pathMatch(.*)*", component: NotFoundPage },
    ],
  });
  await router.push("/missing");
  const wrapper = mount(App, { global: { plugins: [router] } });
  expect(wrapper.get("main").text()).toContain("这个赛场不存在");
  const returnLink = wrapper.get('main a[href="/"]');
  expect(returnLink.attributes("href")).toBe("/");
  await returnLink.trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/");
  expect(wrapper.get("main h1").text()).toBe("游戏大厅");
  expect(wrapper.get("a.skip-link").attributes("href")).toBe("#main-content");
});

test("the header keeps a fixed navigation and searches catalog games in a switcher", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/games/:gameId/:section?", component: { render: () => h("h1", "页面") } },
      { path: "/:pathMatch(.*)*", component: {} },
    ],
  });
  await router.push("/games/royale/development");
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  const nav = wrapper.get('nav[aria-label="主导航"]');
  expect(nav.findAll("a").map((link) => link.text())).toEqual(["大厅", "排行榜", "本地回放"]);
  const picker = wrapper.get('button[aria-controls="game-directory"]');
  expect(picker.text()).toBe("圈地大逃杀");
  expect(wrapper.find("#game-directory").exists()).toBe(false);
  await picker.trigger("click");
  expect(picker.attributes("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(wrapper.get("#game-search").element);
  const directory = wrapper.get('nav[aria-label="切换游戏"]');
  expect(directory.get('a[href="/games/royale"]').attributes("aria-current")).toBe("page");
  await wrapper.get("#game-search").setValue("PAPER");
  expect(wrapper.get('nav[aria-label="切换游戏"]').findAll("a")).toHaveLength(1);
  await wrapper.get("#game-search").setValue("不存在");
  expect(wrapper.text()).toContain("没有找到匹配的游戏");
  await wrapper.get("#game-search").trigger("keydown", { key: "Escape" });
  expect(picker.attributes("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(picker.element);
  await picker.trigger("click");
  await wrapper.get('#game-directory a[href="/games/paper"]').trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/games/paper");
  expect(picker.text()).toBe("网格圈地");
  expect(picker.attributes("aria-expanded")).toBe("false");
  const toggle = wrapper.get('button[aria-controls="site-menu"]');
  await toggle.trigger("click");
  expect(toggle.attributes("aria-expanded")).toBe("true");
  await nav.get('a[href="/leaderboard"]').trigger("click");
  await flushPromises();
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(nav.get('a[href="/leaderboard"]').attributes("aria-current")).toBe("page");
});

test("the game search supports keyboard navigation and does not navigate during IME composition", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/games/:gameId", component: {} },
      { path: "/:pathMatch(.*)*", component: {} },
    ],
  });
  await router.push("/games/royale");
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  await wrapper.get('button[aria-controls="game-directory"]').trigger("click");
  const search = wrapper.get("#game-search");
  await search.trigger("keydown", { key: "ArrowDown" });
  const first = wrapper.get('#game-directory a[href="/games/paper"]');
  const last = wrapper.get('#game-directory a[href="/games/royale"]');
  expect(document.activeElement).toBe(first.element);
  await first.trigger("keydown", { key: "ArrowUp" });
  expect(document.activeElement).toBe(last.element);
  await last.trigger("keydown", { key: "Escape" });
  await wrapper.get('button[aria-controls="game-directory"]').trigger("click");
  await wrapper.get("#game-search").setValue("paper");
  await wrapper.get("#game-search").trigger("keydown", { key: "Enter", isComposing: true });
  expect(router.currentRoute.value.path).toBe("/games/royale");
  await wrapper.get("#game-search").trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/games/paper");
  expect(wrapper.find("#game-directory").exists()).toBe(false);
});
