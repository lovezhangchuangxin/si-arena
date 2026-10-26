import {
  paperGame,
  developmentFiles,
  officialBotUrl,
  PAPER_SDK_SOURCE,
} from "@si-arena/game-paper/game";
import * as royale from "@si-arena/game-royale/game";
import * as snake from "@si-arena/game-snake/game";
import * as bomber from "@si-arena/game-bomber/game";
import * as tank from "@si-arena/game-tank/game";
import * as tetris from "@si-arena/game-tetris/game";
import * as cube from "@si-arena/game-cube/game";
import * as danmaku from "@si-arena/game-danmaku/game";

// Trusted build registrations: adding a game does not change the archive builder.
export const devkitGames = [
  {
    game: paperGame,
    packageName: "@si-arena/game-paper",
    directory: "games/paper",
    gameExport: "paperGame",
    sdkSourceExport: "PAPER_SDK_SOURCE",
    sdkInputType: "PaperTickInput",
    developmentFiles,
    officialBotUrl,
    sdkSource: PAPER_SDK_SOURCE,
  },
  {
    game: royale.royaleGame,
    packageName: "@si-arena/game-royale",
    directory: "games/royale",
    gameExport: "royaleGame",
    sdkSourceExport: "ROYALE_SDK_SOURCE",
    sdkInputType: "RoyaleTickInput",
    developmentFiles: royale.developmentFiles,
    officialBotUrl: royale.officialBotUrl,
    sdkSource: royale.ROYALE_SDK_SOURCE,
  },
  {
    game: snake.snakeGame,
    packageName: "@si-arena/game-snake",
    directory: "games/snake",
    gameExport: "snakeGame",
    sdkSourceExport: "SNAKE_SDK_SOURCE",
    sdkInputType: "SnakeTickInput",
    developmentFiles: snake.developmentFiles,
    officialBotUrl: snake.officialBotUrl,
    sdkSource: snake.SNAKE_SDK_SOURCE,
  },
  {
    game: bomber.bomberGame,
    packageName: "@si-arena/game-bomber",
    directory: "games/bomber",
    gameExport: "bomberGame",
    sdkSourceExport: "BOMBER_SDK_SOURCE",
    sdkInputType: "BomberTickInput",
    developmentFiles: bomber.developmentFiles,
    officialBotUrl: bomber.officialBotUrl,
    sdkSource: bomber.BOMBER_SDK_SOURCE,
  },
  {
    game: tank.tankGame,
    packageName: "@si-arena/game-tank",
    directory: "games/tank",
    gameExport: "tankGame",
    sdkSourceExport: "TANK_SDK_SOURCE",
    sdkInputType: "TankTickInput",
    developmentFiles: tank.developmentFiles,
    officialBotUrl: tank.officialBotUrl,
    sdkSource: tank.TANK_SDK_SOURCE,
  },
  {
    game: tetris.tetrisGame,
    packageName: "@si-arena/game-tetris",
    directory: "games/tetris",
    gameExport: "tetrisGame",
    sdkSourceExport: "TETRIS_SDK_SOURCE",
    sdkInputType: "TetrisTickInput",
    developmentFiles: tetris.developmentFiles,
    officialBotUrl: tetris.officialBotUrl,
    sdkSource: tetris.TETRIS_SDK_SOURCE,
  },
  {
    game: cube.cubeGame,
    packageName: "@si-arena/game-cube",
    directory: "games/cube",
    gameExport: "cubeGame",
    sdkSourceExport: "CUBE_SDK_SOURCE",
    sdkInputType: "CubeTickInput",
    developmentFiles: cube.developmentFiles,
    officialBotUrl: cube.officialBotUrl,
    sdkSource: cube.CUBE_SDK_SOURCE,
  },
  {
    game: danmaku.danmakuGame,
    packageName: "@si-arena/game-danmaku",
    directory: "games/danmaku",
    gameExport: "danmakuGame",
    sdkSourceExport: "DANMAKU_SDK_SOURCE",
    sdkInputType: "DanmakuTickInput",
    developmentFiles: danmaku.developmentFiles,
    officialBotUrl: danmaku.officialBotUrl,
    sdkSource: danmaku.DANMAKU_SDK_SOURCE,
  },
];
