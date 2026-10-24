import type { GameCatalogEntry } from "@si-arena/protocol";
import { paperGame } from "@si-arena/game-paper/game";
import { drawPaperBoard } from "@si-arena/game-paper/renderer";
import { royaleGame } from "@si-arena/game-royale/game";
import { drawRoyaleBoard } from "@si-arena/game-royale/renderer";
import { snakeGame } from "@si-arena/game-snake/game";
import { drawSnakeBoard } from "@si-arena/game-snake/renderer";
import { bomberGame } from "@si-arena/game-bomber/game";
import { drawBomberBoard } from "@si-arena/game-bomber/renderer";
import { tankGame } from "@si-arena/game-tank/game";
import { drawTankBoard } from "@si-arena/game-tank/renderer";
import { tetrisGame } from "@si-arena/game-tetris/game";
import { drawTetrisBoard, TETRIS_ASPECT_RATIO } from "@si-arena/game-tetris/renderer";

import {
  paperShowcase,
  royaleShowcase,
  snakeShowcase,
  bomberShowcase,
  bomberShowcaseEvents,
  tankShowcase,
  tetrisShowcase,
} from "./showcases";

export interface GamePreviewScene {
  aspectRatio: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}

// Trusted initial or art-directed worlds only. No bot, match or tick is executed.
export const gamePreviews: ReadonlyMap<
  string,
  (game: GameCatalogEntry, showcase?: boolean) => GamePreviewScene
> = new Map([
  [
    paperGame.manifest.id,
    (game, showcase = false) => {
      if (game.release !== paperGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const config = paperGame.parseConfig(game.config);
      const initial = paperGame.rules.init({
        seed: 42,
        config,
        players: [
          { id: "preview-1", slot: 0 },
          { id: "preview-2", slot: 1 },
        ],
      });
      const state = paperGame.parseState(showcase ? paperShowcase(initial) : initial, {
        config: game.config,
        players: initial.players,
      });
      return {
        aspectRatio: state.width / state.height,
        draw: (context, width, height) =>
          drawPaperBoard(context, state, width, height, {
            previousState: state,
            events: [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
      };
    },
  ],
  [
    royaleGame.manifest.id,
    (game, showcase = false) => {
      if (game.release !== royaleGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const initial = royaleGame.rules.init({
        seed: 42,
        config: royaleGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
      });
      const state = royaleGame.parseState(showcase ? royaleShowcase(initial) : initial, {
        config: game.config,
        players: initial.players,
      });
      return {
        aspectRatio: state.width / state.height,
        draw: (context, width, height) =>
          drawRoyaleBoard(context, state, width, height, {
            previousState: state,
            events: [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
      };
    },
  ],
  [
    snakeGame.manifest.id,
    (game, showcase = false) => {
      if (game.release !== snakeGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const initial = snakeGame.rules.init({
        seed: 42,
        config: snakeGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
      });
      const state = snakeGame.parseState(showcase ? snakeShowcase(initial) : initial, {
        config: game.config,
        players: initial.snakes,
      });
      return {
        aspectRatio: state.width / state.height,
        draw: (context, width, height) =>
          drawSnakeBoard(context, state, width, height, {
            previousState: state,
            events: [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
      };
    },
  ],
  [
    bomberGame.manifest.id,
    (game, showcase = false) => {
      if (game.release !== bomberGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const initial = bomberGame.rules.init({
        seed: 42,
        config: bomberGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
      });
      const state = bomberGame.parseState(showcase ? bomberShowcase(initial) : initial, {
        config: game.config,
        players: initial.players,
      });
      return {
        aspectRatio: state.width / state.height,
        draw: (context, width, height) =>
          drawBomberBoard(context, state, width, height, {
            previousState: state,
            events: showcase ? bomberShowcaseEvents(state) : [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
      };
    },
  ],
  [
    tankGame.manifest.id,
    (game, showcase = false) => {
      if (game.release !== tankGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const initial = tankGame.rules.init({
        seed: 42,
        config: tankGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
      });
      const state = tankGame.parseState(showcase ? tankShowcase(initial) : initial, {
        config: game.config,
        players: initial.tanks,
      });
      return {
        aspectRatio: state.width / state.height,
        draw: (context, width, height) =>
          drawTankBoard(context, state, width, height, {
            previousState: state,
            events: [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
      };
    },
  ],
  [
    tetrisGame.manifest.id,
    (game, showcase = false) => {
      if (game.release !== tetrisGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const initial = tetrisGame.rules.init({
        seed: 42,
        config: tetrisGame.parseConfig(game.config),
        players: [{ id: "preview-1", slot: 0 }],
      });
      const state = tetrisGame.parseState(showcase ? tetrisShowcase(initial) : initial, {
        config: game.config,
        players: [{ id: initial.playerId, slot: 0 }],
      });
      return {
        aspectRatio: TETRIS_ASPECT_RATIO,
        draw: (context, width, height) =>
          drawTetrisBoard(context, state, width, height, {
            previousState: state,
            events: [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
      };
    },
  ],
]);
