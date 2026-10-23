<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { isSoloGame } from "@si-arena/protocol";
import { parseGameMe } from "../api/contracts";
import { useApiResource } from "../composables/useApiResource";

/** The signed-in user's standing in one game, including the private boss record. */
const props = defineProps<{ game: GameCatalogEntry }>();
const { data, status } = useApiResource(
  () => `/api/games/${encodeURIComponent(props.game.id)}/me`,
  parseGameMe,
  { authenticated: true, notify: false },
);
</script>

<template>
  <div class="tile p-3">
    <dt class="text-xs text-faint">{{ game.name }}{{ isSoloGame(game) ? " 最高分" : " 排位" }}</dt>
    <dd v-if="status === 'error'" class="mt-1 text-sm text-soft">暂时读不到</dd>
    <dd v-else-if="!data" class="figure mt-1 text-xl text-faint">—</dd>
    <dd v-else-if="isSoloGame(game)" class="mt-1">
      <span class="figure text-xl">{{ data.entry.bestScore.toLocaleString() }}</span>
      <span class="text-xs text-soft"> 分 · {{ data.entry.matchesPlayed }} 次</span>
    </dd>
    <dd v-else-if="game.arena" class="mt-1">
      <span class="figure text-xl">{{ data.entry.rating.toFixed(2) }}</span>
      <span class="text-xs text-soft">
        排位分 · {{ data.entry.wins }} 冠 / {{ data.entry.matchesPlayed }} 场</span
      >
    </dd>
    <dd v-else class="figure mt-1 text-xl">{{ data.entry.rating.toFixed(2) }}</dd>
  </div>
  <div v-if="data?.boss.available && !game.arena" class="tile p-3">
    <dt class="text-xs text-faint">{{ game.name }} Boss 战绩</dt>
    <dd class="mt-1">
      <span class="figure text-xl">{{ data.boss.wins }}</span>
      <span class="text-xs text-soft"> 胜 / {{ data.boss.attempts }} 次</span>
    </dd>
  </div>
</template>
