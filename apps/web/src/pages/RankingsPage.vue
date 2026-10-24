<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useCatalog } from "../games/catalog";
import { leaderboardBlurb } from "../games/leaderboard";
import { moveTabFocus } from "../utils/tablist";
import LeaderboardPage from "./LeaderboardPage.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const route = useRoute();
const catalog = useCatalog();
const games = computed(() => catalog.data.value?.games ?? []);
const selected = computed(
  () => games.value.find((game) => game.id === route.query.game) ?? games.value[0],
);
</script>

<template>
  <div class="mx-auto flex max-w-[67.5rem] flex-col gap-6">
    <header class="page-header flex flex-wrap items-end justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1.5">
        <h1 class="text-[30px] font-black sm:text-[34px]">排行榜</h1>
        <p v-if="selected" class="max-w-2xl text-[15px] leading-7 text-soft">
          {{ leaderboardBlurb(selected) }}
        </p>
      </div>
      <nav
        v-if="games.length > 1"
        role="tablist"
        aria-label="玩法"
        class="rankings-tabs flex w-full min-w-0 max-w-full gap-1 overflow-x-auto rounded-panel border border-line bg-surface p-1"
        @keydown="moveTabFocus"
      >
        <RouterLink
          v-for="game in games"
          :id="`rankings-tab-${game.id}`"
          :key="game.id"
          role="tab"
          :aria-selected="game.id === selected?.id"
          aria-controls="rankings-panel"
          :tabindex="game.id === selected?.id ? 0 : -1"
          :to="{ query: { game: game.id } }"
          class="flex min-h-11 shrink-0 items-center rounded-[0.5625rem] px-[1.125rem] text-[15px] font-bold transition"
          :class="
            game.id === selected?.id ? 'bg-accent text-on-accent' : 'text-ink hover:bg-subtle'
          "
          >{{ game.name }}</RouterLink
        >
      </nav>
    </header>
    <StateBlock v-if="catalog.status.value === 'loading'" status="loading" />
    <StateBlock
      v-else-if="catalog.status.value === 'error'"
      status="error"
      :message="catalog.error.value"
      @retry="catalog.reload"
    />
    <StateBlock v-else-if="!selected" status="empty" message="暂时还没有游戏。" />
    <section
      v-else
      id="rankings-panel"
      role="tabpanel"
      :aria-labelledby="games.length > 1 ? `rankings-tab-${selected.id}` : undefined"
      :aria-label="games.length > 1 ? undefined : `${selected.name}排行榜`"
    >
      <LeaderboardPage :key="selected.id" :game="selected" headless />
    </section>
  </div>
</template>
