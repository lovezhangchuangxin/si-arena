<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import { parseGame } from "../api/contracts";
import { session } from "../auth/session";
import { useArena } from "../composables/useArena";
import ArenaPanel from "../components/ArenaPanel.vue";
import { useApiResource } from "../composables/useApiResource";
import AccountGate from "../components/AccountGate.vue";
import GameEntry from "../components/GameEntry.vue";
import GameMatch from "../components/GameMatch.vue";
import GameNavigation from "../components/GameNavigation.vue";
import GamePreview from "../components/GamePreview.vue";
import GameStageHeader from "../components/GameStageHeader.vue";
import GamePage from "./GamePage.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const route = useRoute();
const entry = ref<InstanceType<typeof GameEntry> | null>(null);
const detailsTarget = ref<HTMLElement | null>(null);
const actions = ref<HTMLElement | null>(null);
const actionsHeight = ref(0);
const panel = ref<{ refresh?: () => Promise<void> } | null>(null);
const id = computed(() => String(route.params.gameId));
const selectedMatch = computed(() =>
  typeof route.query.match === "string" ? route.query.match : null,
);
const tab = computed(() => {
  const section = route.path
    .slice(`/games/${encodeURIComponent(id.value)}`.length)
    .replace(/^\//, "");
  if (section === "rules") return "play";
  if (section) return section;
  if (route.query.tab === "arena" && game.value?.arena) return "arena";
  return route.query.tab === "play"
    ? "play"
    : route.query.tab === "match" || selectedMatch.value
      ? "match"
      : game.value?.arena
        ? "arena"
        : "play";
});
const {
  data: game,
  status,
  error,
  reload,
} = useApiResource(() => `/api/games/${encodeURIComponent(id.value)}`, parseGame);
const arena = useArena(() => game.value);
watch(arena.status.data, (current, previous) => {
  if (!current || !previous) return;
  const activeEnded = previous.active && previous.active.id !== current.active?.id;
  // A whole run can finish between polls, without an observed active -> idle transition.
  const newResult = current.recent.some(
    (match) => !previous.recent.some((old) => old.id === match.id),
  );
  if (activeEnded || newResult) {
    void entry.value?.refresh();
    void panel.value?.refresh?.();
  }
});
let observer: ResizeObserver | undefined;
watch(
  actions,
  (element) => {
    observer?.disconnect();
    if (!element) return;
    const measure = () => {
      actionsHeight.value = element.getBoundingClientRect().height;
    };
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    measure();
  },
  { flush: "post" },
);
onBeforeUnmount(() => observer?.disconnect());
function settled() {
  void entry.value?.refresh();
  void panel.value?.refresh?.();
  if (game.value?.arena) void arena.status.reload();
}
</script>

<template>
  <div class="game-workbench" :style="{ '--game-actions-height': `${actionsHeight}px` }">
    <StateBlock v-if="status === 'loading'" status="loading" />
    <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
    <div v-else-if="game" :key="game.id" class="game-columns">
      <GameMatch
        v-if="selectedMatch"
        :key="`${game.id}:${selectedMatch}`"
        :game="game"
        :match-id="selectedMatch"
        :details-target="detailsTarget"
        @settled="settled"
      />
      <section v-else class="game-stage" aria-label="比赛画面">
        <GameStageHeader :game="game" :title="game.name" />
        <GamePreview :game="game" />
      </section>
      <aside class="game-sidebar" aria-label="游戏工作台">
        <GameNavigation :game-id="game.id" :active-tab="tab" :arena="!!game.arena" />
        <div class="game-content">
          <section
            v-if="game.arena"
            v-show="tab === 'arena'"
            id="game-panel-arena"
            class="game-panel"
            role="tabpanel"
            aria-labelledby="game-tab-arena"
          >
            <ArenaPanel :game="game" :arena="arena" />
          </section>
          <section
            v-show="tab === 'play'"
            id="game-panel-play"
            class="game-panel"
            role="tabpanel"
            aria-labelledby="game-tab-play"
          >
            <GamePage :game="game" :code="entry?.data?.code ?? null" :entry-ready="!!entry?.data" />
          </section>
          <section
            v-show="tab === 'match'"
            id="game-panel-match"
            class="game-panel"
            role="tabpanel"
            aria-labelledby="game-tab-match"
          >
            <p v-if="!selectedMatch" class="text-sm text-soft">
              尚未选择比赛。发起匹配，或在「我的比赛」里打开一场。
            </p>
            <div ref="detailsTarget" class="space-y-4" />
          </section>
          <div
            v-if="tab !== 'play' && tab !== 'match' && tab !== 'arena'"
            :id="`game-panel-${tab}`"
            class="game-panel"
            role="tabpanel"
            :aria-labelledby="`game-tab-${tab}`"
          >
            <RouterView v-slot="{ Component }"
              ><component
                :is="Component"
                ref="panel"
                :key="`${game.id}:${route.path}`"
                :game="game"
            /></RouterView>
          </div>
        </div>
        <div id="participate" ref="actions" class="game-actions">
          <AccountGate
            ><GameEntry
              ref="entry"
              :key="`${game.id}:${session.user?.id}`"
              :game="game"
              :arena="arena"
              compact
          /></AccountGate>
        </div>
      </aside>
    </div>
  </div>
</template>
