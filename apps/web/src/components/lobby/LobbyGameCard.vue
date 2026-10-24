<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { isSoloGame, type GameCatalogEntry } from "@si-arena/protocol";
import LobbyIcon from "./LobbyIcon.vue";
import LobbyGameCover from "./LobbyGameCover.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
// Presentation metadata only; game behavior remains in the trusted game packages.
const themes: Record<string, { color: string; tag: string }> = {
  paper: { color: "#ffbb58", tag: "策略规划" },
  royale: { color: "#c079ff", tag: "生存对抗" },
  snake: { color: "#54efbb", tag: "空间博弈" },
  bomber: { color: "#42cbff", tag: "连锁对抗" },
  tank: { color: "#ff777e", tag: "战术对决" },
  tetris: { color: "#ad8aff", tag: "策略优化" },
};
const theme = computed(() => themes[props.game.id] ?? { color: "#8dffa6", tag: "代码竞技" });
const mode = computed(() =>
  props.game.arena ? "多人竞技场" : isSoloGame(props.game) ? "单人挑战" : "双人对抗",
);
const seats = computed(() =>
  props.game.minPlayers === props.game.maxPlayers
    ? `${props.game.maxPlayers} 人`
    : `${props.game.minPlayers}–${props.game.maxPlayers} 人`,
);
</script>

<template>
  <article class="lobby-game-card" :style="{ '--game-color': theme.color }">
    <div class="lobby-game-copy">
      <h3>
        <span>{{ game.id.toUpperCase() }}</span
        >{{ game.name }}
      </h3>
      <div class="lobby-game-tags">
        <span>{{ mode }}</span
        ><span>{{ theme.tag }}</span>
      </div>
      <p class="lobby-game-description">{{ game.description }}</p>
    </div>
    <div class="lobby-game-cover"><LobbyGameCover :game="game" /></div>
    <div class="lobby-game-meta">
      <LobbyIcon :name="game.arena ? 'arena' : isSoloGame(game) ? 'chart' : 'duel'" />{{ seats }} ·
      {{ mode }}
    </div>
    <RouterLink
      class="lobby-enter"
      :to="`/games/${encodeURIComponent(game.id)}`"
      :aria-label="`进入${game.name}`"
    >
      进入游戏 <LobbyIcon name="arrow" />
    </RouterLink>
  </article>
</template>
