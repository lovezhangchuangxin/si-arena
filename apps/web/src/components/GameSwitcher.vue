<script setup lang="ts">
import { isSoloGame } from "@si-arena/protocol";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useCatalog } from "../games/catalog";
import StateBlock from "./ui/StateBlock.vue";

const route = useRoute();
const catalog = useCatalog();
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const open = ref(false);
const query = ref("");
const games = computed(() => catalog.data.value?.games ?? []);
const current = computed(() => games.value.find((game) => game.id === route.params.gameId));
const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return games.value.filter((game) => `${game.name} ${game.id}`.toLocaleLowerCase().includes(term));
});
function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
async function toggle() {
  open.value = !open.value;
  query.value = "";
  if (open.value) {
    await nextTick();
    search.value?.focus();
  }
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close();
}
function leave(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close();
}
watch(
  () => route.fullPath,
  () => close(),
);
onMounted(() => document.addEventListener("pointerdown", outside));
onUnmounted(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div
    ref="root"
    class="min-w-0 sm:relative"
    @focusout="leave"
    @keydown.esc.stop.prevent="close(true)"
  >
    <button
      ref="trigger"
      type="button"
      aria-controls="game-directory"
      :aria-expanded="open"
      :aria-label="current ? `切换游戏：${current.name}` : '选择游戏'"
      class="flex min-h-11 max-w-36 items-center gap-2 rounded-control border border-line bg-subtle px-3 text-sm text-ink transition hover:border-line-strong sm:max-w-48"
      @click="toggle"
    >
      <span class="truncate">{{ current?.name ?? "选择游戏" }}</span>
      <svg class="size-3.5 shrink-0 text-soft" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
    <section
      v-if="open"
      id="game-directory"
      aria-label="游戏目录"
      class="absolute inset-x-3 top-full z-50 mt-2 flex max-h-[min(70dvh,32rem)] flex-col overflow-hidden rounded-panel border border-line-strong bg-surface shadow-pop sm:right-auto sm:left-0 sm:w-80"
    >
      <div class="shrink-0 border-b border-line p-3">
        <label class="sr-only" for="game-search">搜索游戏</label>
        <input
          id="game-search"
          ref="search"
          v-model="query"
          type="search"
          class="input"
          placeholder="搜索名称或游戏 ID"
        />
      </div>
      <div class="min-h-0 overflow-y-auto p-2">
        <StateBlock v-if="catalog.status.value === 'loading'" status="loading" />
        <StateBlock
          v-else-if="catalog.status.value === 'error'"
          status="error"
          :message="catalog.error.value"
          @retry="catalog.reload"
        />
        <p v-else-if="!filtered.length" class="px-3 py-6 text-center text-sm text-soft">
          {{ games.length ? "没有找到匹配的游戏" : "暂时还没有可玩的游戏" }}
        </p>
        <nav v-else aria-label="切换游戏" class="flex flex-col gap-1">
          <RouterLink
            v-for="game in filtered"
            :key="game.id"
            :to="`/games/${encodeURIComponent(game.id)}`"
            :aria-current="current?.id === game.id ? 'page' : undefined"
            class="flex min-h-14 items-center justify-between gap-3 rounded-control px-3 py-2 transition hover:bg-subtle"
            :class="current?.id === game.id ? 'bg-accent-soft text-accent' : 'text-ink'"
            @click="close()"
          >
            <span class="min-w-0 truncate text-sm font-medium">{{ game.name }}</span>
            <span class="shrink-0 text-xs text-soft">{{
              game.arena
                ? `${game.arena.seats} 人竞技场`
                : isSoloGame(game)
                  ? "单人挑战"
                  : "双人对抗"
            }}</span>
          </RouterLink>
        </nav>
      </div>
      <RouterLink
        to="/"
        class="shrink-0 border-t border-line px-5 py-3 text-sm text-soft hover:text-ink"
        @click="close()"
        >查看全部游戏 →</RouterLink
      >
    </section>
  </div>
</template>
