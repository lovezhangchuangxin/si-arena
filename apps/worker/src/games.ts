import { paperGame } from "@si-arena/game-paper/game";
import { royaleGame } from "@si-arena/game-royale/game";
import { snakeGame } from "@si-arena/game-snake/game";
import { bomberGame } from "@si-arena/game-bomber/game";
import { tankGame } from "@si-arena/game-tank/game";
import { tetrisGame } from "@si-arena/game-tetris/game";
import { defineSandboxGame, type SandboxGameRegistration } from "./sandbox-match";

// New games join by registering their trusted definition here; the rest of the
// worker stays game-agnostic.
const registrations: readonly SandboxGameRegistration[] = [
  defineSandboxGame({
    game: paperGame,
    module: {
      url: import.meta.resolve("@si-arena/game-paper/game"),
      gameExport: "paperGame",
      sdkSourceExport: "PAPER_SDK_SOURCE",
    },
  }),
  defineSandboxGame({
    game: royaleGame,
    module: {
      url: import.meta.resolve("@si-arena/game-royale/game"),
      gameExport: "royaleGame",
      sdkSourceExport: "ROYALE_SDK_SOURCE",
    },
  }),
  defineSandboxGame({
    game: snakeGame,
    module: {
      url: import.meta.resolve("@si-arena/game-snake/game"),
      gameExport: "snakeGame",
      sdkSourceExport: "SNAKE_SDK_SOURCE",
    },
  }),
  defineSandboxGame({
    game: bomberGame,
    module: {
      url: import.meta.resolve("@si-arena/game-bomber/game"),
      gameExport: "bomberGame",
      sdkSourceExport: "BOMBER_SDK_SOURCE",
    },
  }),
  defineSandboxGame({
    game: tankGame,
    module: {
      url: import.meta.resolve("@si-arena/game-tank/game"),
      gameExport: "tankGame",
      sdkSourceExport: "TANK_SDK_SOURCE",
    },
  }),
  defineSandboxGame({
    game: tetrisGame,
    module: {
      url: import.meta.resolve("@si-arena/game-tetris/game"),
      gameExport: "tetrisGame",
      sdkSourceExport: "TETRIS_SDK_SOURCE",
    },
  }),
];

/** The worker only claims matches whose frozen release it has installed. */
export function claimableReleases(): ReadonlyArray<{ gameId: string; release: string }> {
  return registrations.map((game) => ({ gameId: game.gameId, release: game.release }));
}

export function findWorkerGame(gameId: string, release: string): SandboxGameRegistration | null {
  return registrations.find((game) => game.gameId === gameId && game.release === release) ?? null;
}
