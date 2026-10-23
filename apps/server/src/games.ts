import { paperCatalogEntry } from "@si-arena/game-paper";
import { developmentFiles, officialBotUrl } from "@si-arena/game-paper/game";
import { royaleCatalogEntry } from "@si-arena/game-royale";
import {
  developmentFiles as royaleDevelopmentFiles,
  officialBotUrl as royaleOfficialBotUrl,
} from "@si-arena/game-royale/game";
import { snakeCatalogEntry } from "@si-arena/game-snake";
import {
  developmentFiles as snakeDevelopmentFiles,
  officialBotUrl as snakeOfficialBotUrl,
} from "@si-arena/game-snake/game";
import { bomberCatalogEntry } from "@si-arena/game-bomber";
import {
  developmentFiles as bomberDevelopmentFiles,
  officialBotUrl as bomberOfficialBotUrl,
} from "@si-arena/game-bomber/game";
import { tankCatalogEntry } from "@si-arena/game-tank";
import {
  developmentFiles as tankDevelopmentFiles,
  officialBotUrl as tankOfficialBotUrl,
} from "@si-arena/game-tank/game";
import { tetrisCatalogEntry } from "@si-arena/game-tetris";
import {
  developmentFiles as tetrisDevelopmentFiles,
  officialBotUrl as tetrisOfficialBotUrl,
} from "@si-arena/game-tetris/game";
import type { GameCatalogEntry } from "@si-arena/protocol";

export interface RegisteredGame {
  entry: GameCatalogEntry;
  officialBotUrl: URL;
  developmentFiles: { prompt: URL; sdk: URL; template: URL };
}

export const registeredGames: readonly RegisteredGame[] = [
  { entry: paperCatalogEntry, officialBotUrl, developmentFiles },
  {
    entry: royaleCatalogEntry,
    officialBotUrl: royaleOfficialBotUrl,
    developmentFiles: royaleDevelopmentFiles,
  },
  {
    entry: snakeCatalogEntry,
    officialBotUrl: snakeOfficialBotUrl,
    developmentFiles: snakeDevelopmentFiles,
  },
  {
    entry: bomberCatalogEntry,
    officialBotUrl: bomberOfficialBotUrl,
    developmentFiles: bomberDevelopmentFiles,
  },
  {
    entry: tankCatalogEntry,
    officialBotUrl: tankOfficialBotUrl,
    developmentFiles: tankDevelopmentFiles,
  },
  {
    entry: tetrisCatalogEntry,
    officialBotUrl: tetrisOfficialBotUrl,
    developmentFiles: tetrisDevelopmentFiles,
  },
];

export const gameCatalog: ReadonlyMap<string, GameCatalogEntry> = new Map(
  registeredGames.map((game) => [game.entry.id, game.entry]),
);
