import { defineLocalGame } from "@si-arena/cli";
import { paperGame, officialBotUrl } from "@si-arena/game-paper/game";
import * as royale from "@si-arena/game-royale/game";
import * as snake from "@si-arena/game-snake/game";
import * as bomber from "@si-arena/game-bomber/game";
import * as tank from "@si-arena/game-tank/game";
import * as tetris from "@si-arena/game-tetris/game";
import * as cube from "@si-arena/game-cube/game";
import * as danmaku from "@si-arena/game-danmaku/game";
import * as investment from "@si-arena/game-investment/game";

// Trusted repository registration. Player sources are read as text and only run in the isolated V8 sandbox.
export default [
  defineLocalGame({
    game: paperGame,
    module: {
      url: import.meta.resolve("@si-arena/game-paper/game"),
      gameExport: "paperGame",
      sdkSourceExport: "PAPER_SDK_SOURCE",
    },
    officialBotUrl,
  }),
  defineLocalGame({
    game: royale.royaleGame,
    module: {
      url: import.meta.resolve("@si-arena/game-royale/game"),
      gameExport: "royaleGame",
      sdkSourceExport: "ROYALE_SDK_SOURCE",
    },
    officialBotUrl: royale.officialBotUrl,
  }),
  defineLocalGame({
    game: snake.snakeGame,
    module: {
      url: import.meta.resolve("@si-arena/game-snake/game"),
      gameExport: "snakeGame",
      sdkSourceExport: "SNAKE_SDK_SOURCE",
    },
    officialBotUrl: snake.officialBotUrl,
  }),
  defineLocalGame({
    game: bomber.bomberGame,
    module: {
      url: import.meta.resolve("@si-arena/game-bomber/game"),
      gameExport: "bomberGame",
      sdkSourceExport: "BOMBER_SDK_SOURCE",
    },
    officialBotUrl: bomber.officialBotUrl,
  }),
  defineLocalGame({
    game: tank.tankGame,
    module: {
      url: import.meta.resolve("@si-arena/game-tank/game"),
      gameExport: "tankGame",
      sdkSourceExport: "TANK_SDK_SOURCE",
    },
    officialBotUrl: tank.officialBotUrl,
  }),
  defineLocalGame({
    game: tetris.tetrisGame,
    module: {
      url: import.meta.resolve("@si-arena/game-tetris/game"),
      gameExport: "tetrisGame",
      sdkSourceExport: "TETRIS_SDK_SOURCE",
    },
    officialBotUrl: tetris.officialBotUrl,
  }),
  defineLocalGame({
    game: cube.cubeGame,
    module: {
      url: import.meta.resolve("@si-arena/game-cube/game"),
      gameExport: "cubeGame",
      sdkSourceExport: "CUBE_SDK_SOURCE",
    },
    officialBotUrl: cube.officialBotUrl,
  }),
  defineLocalGame({
    game: danmaku.danmakuGame,
    module: {
      url: import.meta.resolve("@si-arena/game-danmaku/game"),
      gameExport: "danmakuGame",
      sdkSourceExport: "DANMAKU_SDK_SOURCE",
    },
    officialBotUrl: danmaku.officialBotUrl,
  }),
  defineLocalGame({
    game: investment.investmentGame,
    module: {
      url: import.meta.resolve("@si-arena/game-investment/game"),
      gameExport: "investmentGame",
      sdkSourceExport: "INVESTMENT_SDK_SOURCE",
    },
    officialBotUrl: investment.officialBotUrl,
  }),
];
