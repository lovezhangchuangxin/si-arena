import type { GameCatalogEntry } from "@si-arena/protocol";
import type { CubeScene } from "@si-arena/game-cube/renderer";
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
import { cubeGame } from "@si-arena/game-cube/game";
import { cubeScene, CUBE_ASPECT_RATIO } from "@si-arena/game-cube/renderer";
import { danmakuGame } from "@si-arena/game-danmaku/game";
import { drawDanmakuBoard, DANMAKU_ASPECT_RATIO } from "@si-arena/game-danmaku/renderer";

export interface GamePreviewScene {
  aspectRatio: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}

/** Scenes render outside canvas; hosts render them with a DOM component (see CubeStage). */
export interface GamePreviewDomScene {
  aspectRatio: number;
  scene: { kind: "cube" } & CubeScene;
}

/** Trusted initial worlds only. No player source, sandbox, matches, or ticks are executed. */
type GamePreviewFactory = (game: GameCatalogEntry) => GamePreviewScene | GamePreviewDomScene;

const previewEntries: [string, GamePreviewFactory][] = [
  [
    paperGame.manifest.id,
    (game) => {
      if (game.release !== paperGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const config = paperGame.parseConfig(game.config);
      const state = paperGame.rules.init({
        seed: 42,
        config,
        players: [
          { id: "preview-1", slot: 0 },
          { id: "preview-2", slot: 1 },
        ],
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
    (game) => {
      if (game.release !== royaleGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const state = royaleGame.rules.init({
        seed: 42,
        config: royaleGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
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
    (game) => {
      if (game.release !== snakeGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const state = snakeGame.rules.init({
        seed: 42,
        config: snakeGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
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
    (game) => {
      if (game.release !== bomberGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const state = bomberGame.rules.init({
        seed: 42,
        config: bomberGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
      });
      return {
        aspectRatio: state.width / state.height,
        draw: (context, width, height) =>
          drawBomberBoard(context, state, width, height, {
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
    tankGame.manifest.id,
    (game) => {
      if (game.release !== tankGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const state = tankGame.rules.init({
        seed: 42,
        config: tankGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
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
    (game) => {
      if (game.release !== tetrisGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const state = tetrisGame.rules.init({
        seed: 42,
        config: tetrisGame.parseConfig(game.config),
        players: [{ id: "preview-1", slot: 0 }],
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
  [
    cubeGame.manifest.id,
    (game) => {
      if (game.release !== cubeGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const state = cubeGame.rules.init({
        seed: 42,
        config: cubeGame.parseConfig(game.config),
        players: [{ id: "preview-1", slot: 0 }],
      });
      return {
        aspectRatio: CUBE_ASPECT_RATIO,
        scene: {
          kind: "cube" as const,
          ...cubeScene(state, {
            events: [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
        },
      };
    },
  ],
  [
    danmakuGame.manifest.id,
    (game) => {
      if (game.release !== danmakuGame.manifest.release)
        throw new Error("未注册此游戏发行的初始画面。");
      const state = danmakuGame.rules.init({
        seed: 42,
        config: danmakuGame.parseConfig(game.config),
        players: Array.from({ length: game.maxPlayers }, (_, slot) => ({
          id: `preview-${slot + 1}`,
          slot,
        })),
      });
      return {
        aspectRatio: DANMAKU_ASPECT_RATIO,
        draw: (context, width, height) =>
          drawDanmakuBoard(context, state, width, height, {
            previousState: state,
            events: [],
            progress: 1,
            reducedMotion: true,
            erroredPlayers: new Set(),
          }),
      };
    },
  ],
];

export const gamePreviews: ReadonlyMap<string, GamePreviewFactory> = new Map(previewEntries);
