import { expect, test } from "vitest";
import { router } from "../src/router";

test("all game workspace sections lock page scrolling", () => {
  expect(router.resolve("/games/paper").meta.workspace).toBe(true);
  expect(router.resolve("/games/paper/leaderboard").meta.workspace).toBe(true);
  expect(router.resolve("/games/royale/development").meta.workspace).toBe(true);
  expect(router.resolve("/").meta.workspace).toBeUndefined();
});

test("legacy arena links redirect into the unified workspace and preserve match selection", async () => {
  await router.push("/games/snake/arena?match=old&page=2");
  expect(router.currentRoute.value.path).toBe("/games/snake");
  expect(router.currentRoute.value.query).toEqual({ match: "old", page: "2", tab: "match" });
  expect(router.currentRoute.value.meta.workspace).toBe(true);
  await router.push("/royale");
  expect(router.currentRoute.value.fullPath).toBe("/games/royale?tab=arena");
});
