import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { paperGame } from "@si-arena/game-paper/game";
import type { GameMeResponse } from "@si-arena/protocol";
import GameEntry from "../src/components/GameEntry.vue";
import ToastHost from "../src/components/ui/ToastHost.vue";
import { clearSession, signIn } from "../src/auth/session";
import { useToast } from "../src/composables/useToast";

const user = { id: "player", username: "player", official: false };
const game = paperGame.manifest;
const code = {
  source: 'export default () => ({ type: "idle" })',
  sourceBytes: 41,
  botProtocolVersion: game.botProtocolVersion,
  updatedAt: new Date().toISOString(),
};
const me: GameMeResponse = {
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
  code,
  canMatch: true,
  cannotMatchReason: null,
  activeMatch: null,
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  clearSession();
  localStorage.clear();
  useToast().dismiss();
});
afterEach(() => {
  clearSession();
  useToast().dismiss();
  vi.unstubAllGlobals();
});
async function setup(fetch: ReturnType<typeof vi.fn>, initial = me) {
  fetch.mockResolvedValueOnce(response({ user, token: "a".repeat(43) }));
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "player", "secret");
  fetch.mockResolvedValueOnce(response(initial));
  if (initial.activeMatch)
    fetch.mockResolvedValueOnce(
      response({
        ...initial.activeMatch,
        gameId: "paper",
        kind: "ranked",
        release: game.release,
        seed: 1,
        createdAt: code.updatedAt,
        updatedAt: code.updatedAt,
        initiatorId: user.id,
        participants: [],
      }),
    );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: {} },
      { path: "/games/:gameId", component: {} },
    ],
  });
  await router.push("/");
  const wrapper = mount(GameEntry, { props: { game }, global: { plugins: [router] } });
  const toast = mount(ToastHost);
  await flushPromises();
  return { wrapper, router, toast };
}

test("a lost match response retries the same idempotency key and existing matches are reused", async () => {
  const fetch = vi.fn();
  const { wrapper, router, toast } = await setup(fetch);
  fetch
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(
      response({ code: "MATCH_ALREADY_PENDING", message: "已有比赛", matchId: "existing" }, 409),
    )
    .mockResolvedValueOnce(response(me));
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === "发起匹配")!;
  await button.trigger("click");
  await flushPromises();
  expect(toast.text()).toContain("网络连接失败");
  await button.trigger("click");
  await flushPromises();
  const calls = fetch.mock.calls.filter((call) => String(call[0]).endsWith("/matches"));
  expect(calls).toHaveLength(2);
  const keys = calls.map((call) =>
    new Headers(call[1].headers as HeadersInit).get("Idempotency-Key"),
  );
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(router.currentRoute.value.path).toBe("/games/paper");
  expect(router.currentRoute.value.query.match).toBe("existing");
  wrapper.unmount();
  toast.unmount();
});

test("selecting a file uploads immediately without matching, and rejection preserves current code", async () => {
  const fetch = vi.fn();
  const { wrapper, toast } = await setup(fetch);
  const input = wrapper.get("input[type=file]");
  const text = 'export default () => ({type:"idle"})';
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [
      {
        name: "bot.js",
        size: text.length,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      },
    ],
  });
  fetch.mockResolvedValueOnce(response({ code: "CODE_INVALID", message: "无效代码" }, 400));
  await input.trigger("change");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("无效代码");
  expect(wrapper.get("pre").text()).toBe(code.source);
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === "重试上传")!;
  fetch.mockResolvedValueOnce(response(code));
  await button.trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("策略已更新");
  expect(wrapper.get("pre").text()).toBe(text);
  expect(fetch.mock.calls.some((call) => String(call[0]).endsWith("/matches"))).toBe(false);
  wrapper.unmount();
  toast.unmount();
});

function chooseSource(wrapper: Awaited<ReturnType<typeof setup>>["wrapper"], source: string) {
  const input = wrapper.get("input[type=file]");
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [
      {
        name: "bot.js",
        size: source.length,
        arrayBuffer: async () => new TextEncoder().encode(source).buffer,
      },
    ],
  });
  return input.trigger("change");
}

test("a lost upload response is reconciled against server source without resubmitting or matching", async () => {
  const fetch = vi.fn();
  const { wrapper, toast } = await setup(fetch);
  const source = 'export default () => ({type:"idle"})';
  fetch
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ ...me, code: { ...code, source } }));
  await chooseSource(wrapper, source);
  await flushPromises();
  expect(wrapper.text()).toContain("策略已更新");
  expect(wrapper.get("pre").text()).toBe(source);
  expect(fetch.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
  expect(
    fetch.mock.calls.some(
      (call) => call[1]?.method === "POST" && String(call[0]).endsWith("/matches"),
    ),
  ).toBe(false);
  wrapper.unmount();
  toast.unmount();
});

test("an unresolved upload blocks matching until the source is confirmed", async () => {
  const fetch = vi.fn();
  const { wrapper, toast } = await setup(fetch);
  const source = 'export default () => ({type:"idle"})';
  fetch.mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce(response(me));
  await chooseSource(wrapper, source);
  await flushPromises();
  const match = wrapper.findAll("button").find((button) => button.text() === "发起匹配")!;
  expect(match.attributes("disabled")).toBeDefined();
  expect(wrapper.text()).toContain("上传结果待确认");
  expect(wrapper.get("pre").text()).toBe(code.source);
  fetch.mockResolvedValueOnce(response({ ...me, code: { ...code, source } }));
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "核实状态")!
    .trigger("click");
  await flushPromises();
  expect(match.attributes("disabled")).toBeUndefined();
  expect(wrapper.get("pre").text()).toBe(source);
  wrapper.unmount();
  toast.unmount();
});

test("matching stays disabled while uploading, and the same file can be selected again", async () => {
  const fetch = vi.fn();
  const { wrapper, toast } = await setup(fetch);
  let finish: ((value: Response) => void) | undefined;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await chooseSource(wrapper, code.source);
  await flushPromises();
  const match = wrapper.findAll("button").find((button) => button.text() === "发起匹配")!;
  expect(match.attributes("disabled")).toBeDefined();
  expect(wrapper.text()).toContain("上传并校验中");
  finish!(response(code));
  await flushPromises();
  expect(match.attributes("disabled")).toBeUndefined();
  fetch.mockResolvedValueOnce(response(code));
  await chooseSource(wrapper, code.source);
  await flushPromises();
  expect(fetch.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(2);
  wrapper.unmount();
  toast.unmount();
});

test("an existing initiated match is opened without creating another request", async () => {
  const fetch = vi.fn();
  const { wrapper, router, toast } = await setup(fetch, {
    ...me,
    activeMatch: { id: "existing", status: "pending" },
  });
  const link = wrapper.findAll("a").find((a) => a.text() === "查看当前比赛")!;
  await link.trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/games/paper");
  expect(router.currentRoute.value.query.match).toBe("existing");
  expect(
    fetch.mock.calls.some(
      (call) => call[1]?.method === "POST" && String(call[0]).endsWith("/matches"),
    ),
  ).toBe(false);
  wrapper.unmount();
  toast.unmount();
});

test("a stale entry refresh cannot overwrite a just-confirmed upload", async () => {
  const fetch = vi.fn();
  const { wrapper, toast } = await setup(fetch);
  let finishRefresh: ((response: Response) => void) | undefined;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  window.dispatchEvent(new Event("focus"));
  await flushPromises();
  const source = 'export default () => ({type:"idle"})';
  fetch.mockResolvedValueOnce(response(code));
  await chooseSource(wrapper, source);
  await flushPromises();
  expect(wrapper.get("pre").text()).toBe(source);
  finishRefresh!(response(me));
  await flushPromises();
  expect(wrapper.get("pre").text()).toBe(source);
  wrapper.unmount();
  toast.unmount();
});

test("invalid UTF-8 and oversized files never reach the upload endpoint", async () => {
  const fetch = vi.fn();
  const { wrapper, toast } = await setup(fetch);
  const input = wrapper.get("input[type=file]");
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [{ name: "bad.js", size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }],
  });
  await input.trigger("change");
  await flushPromises();
  expect(wrapper.text()).toContain("UTF-8");
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [{ name: "large.js", size: game.resolvedLimits.codeBytes + 1 }],
  });
  await input.trigger("change");
  await flushPromises();
  expect(wrapper.text()).toContain("文件超过");
  expect(fetch).toHaveBeenCalledTimes(2);
  wrapper.unmount();
  toast.unmount();
});

test("the boss challenge appears only when a boss is installed", async () => {
  const { wrapper, toast } = await setup(vi.fn());
  expect(wrapper.text()).not.toContain("挑战 Boss");
  wrapper.unmount();
  toast.unmount();
  const withBoss = await setup(vi.fn(), { ...me, boss: { available: true, attempts: 3, wins: 1 } });
  expect(withBoss.wrapper.text()).toContain("1 胜 / 3 次");
  expect(withBoss.wrapper.findAll("button").some((b) => b.text() === "挑战 Boss")).toBe(true);
  withBoss.wrapper.unmount();
  withBoss.toast.unmount();
});

test("a boss challenge after a lost ranked request sends its own body and idempotency key", async () => {
  const created = {
    id: "boss-match",
    gameId: "paper",
    kind: "boss",
    status: "pending",
    release: game.release,
    seed: 1,
    initiatorId: user.id,
    createdAt: code.updatedAt,
    updatedAt: code.updatedAt,
    participants: [],
  };
  const withBoss = { ...me, boss: { available: true, attempts: 0, wins: 0 } };
  let posts = 0;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/matches") && options?.method === "POST") {
      if (posts++ === 0) throw new TypeError("response lost");
      return response(created, 201);
    }
    if (url.startsWith("/api/matches/")) return response(created);
    return response({ ...withBoss, activeMatch: { id: "boss-match", status: "pending" } });
  });
  const { wrapper, router, toast } = await setup(fetch, withBoss);
  const button = (label: string) => wrapper.findAll("button").find((b) => b.text() === label)!;
  await button("发起匹配").trigger("click");
  await flushPromises();
  await button("挑战 Boss").trigger("click");
  await flushPromises();
  const posted = fetch.mock.calls.filter(
    ([url, options]) => url.endsWith("/matches") && options?.method === "POST",
  );
  expect(posted.map(([, options]) => options?.body)).toEqual(["{}", '{"boss":true}']);
  const keys = posted.map(([, options]) => new Headers(options?.headers).get("Idempotency-Key"));
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBeTruthy();
  expect(keys[1]).not.toBe(keys[0]);
  expect(router.currentRoute.value.query.match).toBe("boss-match");
  wrapper.unmount();
  toast.unmount();
});
