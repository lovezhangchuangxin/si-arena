<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { moveTabFocus } from "../utils/tablist";

const props = defineProps<{ gameId: string; activeTab: string; arena?: boolean }>();
const route = useRoute();
const links = computed(() => {
  const base = `/games/${encodeURIComponent(props.gameId)}`;
  const selected = typeof route.query.match === "string" ? { match: route.query.match } : {};
  return [
    ...(props.arena
      ? [{ id: "arena", label: "竞技场", to: { path: base, query: { ...selected, tab: "arena" } } }]
      : []),
    { id: "play", label: "玩法", to: { path: base, query: { ...selected, tab: "play" } } },
    { id: "match", label: "对局", to: { path: base, query: { ...selected, tab: "match" } } },
    { id: "matches", label: "我的比赛", to: { path: `${base}/matches`, query: selected } },
    { id: "leaderboard", label: "排行榜", to: { path: `${base}/leaderboard`, query: selected } },
    { id: "development", label: "开发资料", to: { path: `${base}/development`, query: selected } },
  ];
});
</script>

<template>
  <nav
    class="game-tabs"
    :class="{ 'game-tabs--arena': arena }"
    role="tablist"
    aria-label="工作台内容"
    @keydown="moveTabFocus"
  >
    <RouterLink
      v-for="link in links"
      :key="link.id"
      :id="`game-tab-${link.id}`"
      role="tab"
      :aria-selected="activeTab === link.id"
      :aria-controls="`game-panel-${link.id}`"
      :tabindex="activeTab === link.id ? 0 : -1"
      :to="link.to"
      class="flex min-h-12 shrink-0 items-center border-b-2 px-3.5 text-sm whitespace-nowrap transition"
      :class="
        activeTab === link.id
          ? 'border-accent font-medium text-ink'
          : 'border-transparent text-soft hover:text-ink'
      "
      >{{ link.label }}</RouterLink
    >
  </nav>
</template>
