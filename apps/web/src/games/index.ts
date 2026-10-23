import { paperPresentation } from "@si-arena/game-paper/renderer";
import { royalePresentation } from "@si-arena/game-royale/renderer";
import { snakePresentation } from "@si-arena/game-snake/renderer";
import { bomberPresentation } from "@si-arena/game-bomber/renderer";
import { tankPresentation } from "@si-arena/game-tank/renderer";
import { tetrisPresentation } from "@si-arena/game-tetris/renderer";
import type { GamePresentation } from "@si-arena/player";

export const gamePresentations: ReadonlyMap<string, GamePresentation> = new Map([
  [paperPresentation.id, paperPresentation],
  [royalePresentation.id, royalePresentation],
  [snakePresentation.id, snakePresentation],
  [bomberPresentation.id, bomberPresentation],
  [tankPresentation.id, tankPresentation],
  [tetrisPresentation.id, tetrisPresentation],
]);
