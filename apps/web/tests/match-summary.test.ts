import type { MatchDetail } from "@si-arena/protocol";
import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import MatchList from "../src/components/MatchList.vue";
import { kindLabel, matchOutcome, ratingDelta, standingChange } from "../src/games/match-summary";

const match: MatchDetail = {
  id: "match",
  gameId: "paper",
  kind: "ranked",
  status: "completed",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  release: "paper@0.3.0",
  seed: 1,
  initiatorId: "initiator",
  participants: [
    {
      userId: "initiator",
      username: "First",
      official: false,
      boss: false,
      slot: 0,
      rank: 2,
      ratingBefore: 1000,
      ratingAfter: 984.123456,
    },
    {
      userId: "opponent",
      username: "Second",
      official: true,
      boss: false,
      slot: 1,
      rank: 1,
      ratingBefore: 1000,
      ratingAfter: 1015.876544,
    },
  ],
};

test("results are relative to the current participant, including passive opponents", () => {
  expect(matchOutcome(match, "initiator").label).toBe("失利");
  expect(matchOutcome(match, "opponent").label).toBe("获胜");
  expect(matchOutcome(match, "spectator").label).toBe("已完成");
  expect(ratingDelta(match.participants[0])).toBe("-15.88");
  expect(ratingDelta(match.participants[1])).toBe("+15.88");
});

test("ties, system failure and unsettled matches do not fabricate wins", () => {
  const tied = { ...match, participants: match.participants.map((p) => ({ ...p, rank: 1 })) };
  expect(matchOutcome(tied, "initiator").label).toBe("平局");
  expect(matchOutcome({ ...match, status: "failed" }, "initiator").label).toBe("系统失败");
  expect(matchOutcome({ ...match, status: "pending" }, "opponent").label).toBe("等待开局");
  expect(ratingDelta({ ...match.participants[0]!, ratingAfter: 1000.000001 })).toBe("0.00");
  expect(ratingDelta(undefined)).toBe("—");
});

test("practice and boss games never show rating changes; arena runs show the place", () => {
  expect(kindLabel("ranked")).toBeUndefined();
  expect(standingChange(match, "initiator")).toBe("-15.88");
  expect(standingChange({ ...match, kind: "practice" }, "initiator")).toBe("不计分");
  expect(standingChange({ ...match, kind: "boss" }, "opponent")).toBe("不计分");
  expect(standingChange({ ...match, status: "failed" }, "opponent")).toBe("不计分");
  expect(standingChange({ ...match, kind: "arena" }, "initiator")).toBe("第 2 名");
  expect(standingChange({ ...match, kind: "arena", status: "running" }, "initiator")).toBe("—");
});

test("solo runs show the achieved score instead of a rating delta", () => {
  expect(kindLabel("solo")).toBe("单人");
  const solo = {
    ...match,
    kind: "solo" as const,
    participants: [
      {
        userId: "initiator",
        username: "First",
        official: false,
        boss: false,
        slot: 0,
        rank: 1,
        score: 1234,
      },
    ],
  };
  expect(standingChange(solo, "initiator")).toBe("1,234 分");
  expect(standingChange({ ...solo, status: "running" }, "initiator")).toBe("—");
  expect(standingChange(solo, "spectator")).toBe("—");
  expect(matchOutcome(solo, "initiator").label).toBe("1,234 分");
  expect(matchOutcome({ ...solo, status: "pending" }, "initiator").label).toBe("等待开局");
});

test("match rows badge practice, boss and arena games", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<p />" } }],
  });
  const boss = {
    ...match,
    id: "boss",
    kind: "boss" as const,
    participants: [
      match.participants[0]!,
      { ...match.participants[1]!, official: false, boss: true },
    ],
  };
  const wrapper = mount(MatchList, {
    props: { matches: [{ ...match, id: "practice", kind: "practice" }, boss, match] },
    global: { plugins: [router] },
  });
  const rows = wrapper.findAll("li");
  expect(rows[0]!.text()).toContain("练习");
  expect(rows[0]!.text()).toContain("不计分");
  expect(rows[1]!.text()).toContain("Boss");
  expect(rows[1]!.text()).toContain("不计分");
  expect(rows[2]!.text()).not.toContain("练习");
  expect(rows[2]!.text()).not.toContain("不计分");
});
