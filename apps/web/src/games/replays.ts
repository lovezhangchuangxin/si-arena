import { defineReplayGame, type ReplayPlayerSummary } from "@si-arena/player/browser";
import type { DeepReadonly, JsonValue } from "@si-arena/protocol";
import { paperGame } from "@si-arena/game-paper/game";
import { drawPaperBoard, paperPlayerSummaries } from "@si-arena/game-paper/renderer";
import { royaleGame } from "@si-arena/game-royale/game";
import {
  drawRoyaleBoard,
  royaleHighlights,
  royalePlayerSummaries,
} from "@si-arena/game-royale/renderer";
import { snakeGame } from "@si-arena/game-snake/game";
import {
  drawSnakeBoard,
  snakeHighlights,
  snakePlayerSummaries,
} from "@si-arena/game-snake/renderer";
import { bomberGame } from "@si-arena/game-bomber/game";
import {
  drawBomberBoard,
  bomberHighlights,
  bomberPlayerSummaries,
} from "@si-arena/game-bomber/renderer";
import { tankGame } from "@si-arena/game-tank/game";
import { drawTankBoard, tankHighlights, tankPlayerSummaries } from "@si-arena/game-tank/renderer";
import { tetrisGame } from "@si-arena/game-tetris/game";
import {
  drawTetrisBoard,
  tetrisHighlights,
  tetrisPlayerSummaries,
  TETRIS_ASPECT_RATIO,
} from "@si-arena/game-tetris/renderer";
import { cubeGame } from "@si-arena/game-cube/game";
import {
  cubeScene,
  cubePlayerSummaries,
  cubeHighlights,
  CUBE_ASPECT_RATIO,
} from "@si-arena/game-cube/renderer";
import { danmakuGame } from "@si-arena/game-danmaku/game";
import {
  drawDanmakuBoard,
  danmakuHighlights,
  danmakuPlayerSummaries,
  DANMAKU_ASPECT_RATIO,
} from "@si-arena/game-danmaku/renderer";

type ReplayGameOptions<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
> = Parameters<typeof defineReplayGame<State, Observation, Action, Event>>[0];

/** The animation input shared by the grid renderers (paper, royale, bomber, tank). */
interface BoardAnimation<State, Event> {
  previousState: DeepReadonly<State>;
  events: DeepReadonly<Event[]>;
  progress: number;
  reducedMotion: boolean;
  erroredPlayers: ReadonlySet<string>;
}

function boardReplay<State extends { tick: number }, Observation, Action extends JsonValue, Event>(
  game: ReplayGameOptions<State, Observation, Action, Event>["game"],
  draw: (
    context: CanvasRenderingContext2D,
    state: DeepReadonly<State>,
    width: number,
    height: number,
    animation: BoardAnimation<State, Event>,
  ) => void,
  summarize: (state: DeepReadonly<State>) => readonly ReplayPlayerSummary[],
  narrate?: ReplayGameOptions<State, Observation, Action, Event>["narrate"],
  options: { aspectRatio?: number; scoreUnit?: string } = {},
) {
  return defineReplayGame({
    game,
    ...(narrate ? { narrate } : {}),
    aspectRatio: options.aspectRatio ?? 1,
    scoreUnit: options.scoreUnit ?? "格",
    draw: (context, frame, width, height, motion) =>
      draw(context, frame.state, width, height, {
        previousState: frame.previousState,
        events: frame.events,
        progress: motion.progress,
        reducedMotion: motion.reducedMotion,
        erroredPlayers: new Set(Object.keys(frame.record?.errors ?? {})),
      }),
    summarize,
  });
}

// Explicit trusted releases, one entry per game; file contents only select an entry, never import code.
export const replayGames = [
  boardReplay(paperGame, drawPaperBoard, paperPlayerSummaries),
  boardReplay(royaleGame, drawRoyaleBoard, royalePlayerSummaries, royaleHighlights),
  boardReplay(snakeGame, drawSnakeBoard, snakePlayerSummaries, snakeHighlights, {
    aspectRatio: 1,
    scoreUnit: "节",
  }),
  boardReplay(bomberGame, drawBomberBoard, bomberPlayerSummaries, bomberHighlights, {
    aspectRatio: 15 / 13,
    scoreUnit: "分",
  }),
  boardReplay(tankGame, drawTankBoard, tankPlayerSummaries, tankHighlights, {
    aspectRatio: 21 / 15,
    scoreUnit: "HP",
  }),
  boardReplay(tetrisGame, drawTetrisBoard, tetrisPlayerSummaries, tetrisHighlights, {
    aspectRatio: TETRIS_ASPECT_RATIO,
    scoreUnit: "分",
  }),
  defineReplayGame({
    game: cubeGame,
    aspectRatio: CUBE_ASPECT_RATIO,
    scoreUnit: "分",
    scene: (frame, motion) => ({
      kind: "cube" as const,
      ...cubeScene(frame.state, {
        events: frame.events,
        progress: motion.progress,
        reducedMotion: motion.reducedMotion,
        erroredPlayers: new Set(Object.keys(frame.record?.errors ?? {})),
      }),
    }),
    summarize: cubePlayerSummaries,
    narrate: cubeHighlights,
  }),
  boardReplay(danmakuGame, drawDanmakuBoard, danmakuPlayerSummaries, danmakuHighlights, {
    aspectRatio: DANMAKU_ASPECT_RATIO,
    scoreUnit: "HP",
  }),
];

/** Whether this web build can verify and draw replays of the given release. */
export function canReplay(gameId: string, release: string): boolean {
  return replayGames.some((entry) => entry.id === gameId && entry.release === release);
}
