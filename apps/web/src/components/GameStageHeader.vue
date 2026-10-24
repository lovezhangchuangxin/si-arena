<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { isSoloGame } from "@si-arena/protocol";

defineProps<{ game: GameCatalogEntry; title: string }>();
</script>

<template>
  <header class="game-stage-header flex shrink-0 flex-wrap items-center justify-between gap-3">
    <div class="flex min-w-0 flex-col gap-2">
      <p class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-faint">
        <span class="rounded-chip border border-line-strong px-1.5 py-0.5 text-soft">{{
          game.arena ? "多人竞技场" : isSoloGame(game) ? "单人挑战" : "双人对抗"
        }}</span>
        <span v-if="title !== game.name" class="text-soft">{{ game.name }}</span>
        <span class="hidden font-mono sm:inline">{{ game.release }}</span>
      </p>
      <h1 class="text-xl font-bold break-words sm:text-2xl">{{ title }}</h1>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>
