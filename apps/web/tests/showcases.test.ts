import { expect, test } from "vitest";
import type { GameCatalogEntry, InitInput, JsonObject, DeepReadonly } from "@si-arena/protocol";
import { paperGame } from "@si-arena/game-paper/game";
import { royaleGame } from "@si-arena/game-royale/game";
import { snakeGame } from "@si-arena/game-snake/game";
import { bomberGame } from "@si-arena/game-bomber/game";
import { tankGame } from "@si-arena/game-tank/game";
import { tetrisGame } from "@si-arena/game-tetris/game";
import {
  paperShowcase,
  royaleShowcase,
  snakeShowcase,
  bomberShowcase,
  tankShowcase,
  tetrisShowcase,
} from "../src/games/showcases";
import { gamePreviews } from "../src/games/previews";

function freeze(value: unknown) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

function verify<State extends { tick: number }>(
  game: {
    manifest: GameCatalogEntry;
    rules: { init(input: InitInput): State };
    parseState(
      raw: unknown,
      context: {
        config: DeepReadonly<JsonObject>;
        players: readonly { id: string; slot: number }[];
      },
    ): State;
  },
  create: (state: State) => State,
) {
  const players = Array.from({ length: game.manifest.maxPlayers }, (_, slot) => ({
    id: `preview-${slot + 1}`,
    slot,
  }));
  const context = { config: game.manifest.config, players };
  const initial = game.rules.init({ ...context, seed: 42 });
  const original = JSON.stringify(initial);
  freeze(initial);
  const state = create(initial);
  expect(state.tick).toBeGreaterThan(0);
  expect(game.parseState(state, context)).toEqual(state);
  expect(create(initial)).toEqual(state);
  expect(JSON.stringify(initial)).toBe(original);
  expect(gamePreviews.get(game.manifest.id)!(game.manifest, true).aspectRatio).toBeGreaterThan(0);
}

test("paper showcase is valid, reproducible and detached from the initial world", () =>
  verify(paperGame, paperShowcase));
test("royale showcase retains valid seats, elimination and safe-zone ownership", () =>
  verify(royaleGame, royaleShowcase));
test("snake showcase has legal bodies, headings and food placement", () =>
  verify(snakeGame, snakeShowcase));
test("bomber showcase respects pillars, empty cells, hidden items and bomb limits", () =>
  verify(bomberGame, bomberShowcase));
test("tank showcase respects spawn clearance and bullets", () => verify(tankGame, tankShowcase));
test("tetris showcase has a valid active piece, queue, level and board", () =>
  verify(tetrisGame, tetrisShowcase));

test("showcases still reject unregistered rule releases", () => {
  expect(() =>
    gamePreviews.get("paper")!({ ...paperGame.manifest, release: "unknown" }, true),
  ).toThrow();
});
