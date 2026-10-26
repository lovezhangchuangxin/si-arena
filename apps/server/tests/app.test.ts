import { test, expect } from "vitest";
import { buildApp } from "../src/app";

test("health and game metadata work without a database or player executor", async () => {
  const app = buildApp();
  try {
    expect((await app.inject("/health")).statusCode).toBe(200);
    const list = (await app.inject("/api/games")).json();
    expect(list.games.map((entry: { id: string }) => entry.id)).toStrictEqual([
      "paper",
      "royale",
      "snake",
      "bomber",
      "tank",
      "tetris",
      "cube",
      "danmaku",
    ]);
    expect(list.games[1].arena).toMatchObject({ seats: 5, keepMatches: 3 });
    const game = (await app.inject("/api/games/paper")).json();
    expect(game.id).toBe("paper");
    expect(game.resolvedLimits.cpuMs).toBe(20);
    expect(game.botProtocolVersion).toBe(2);
    expect(game).toStrictEqual(list.games[0]);
    expect((await app.inject("/api/games/missing")).statusCode).toBe(404);
    expect((await app.inject("/api/games/__proto__")).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
