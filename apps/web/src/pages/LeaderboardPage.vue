<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  clampMatchPage,
  isSoloGame,
  type GameCatalogEntry,
  type LeaderboardPlayer,
} from "@si-arena/protocol";
import { parseLeaderboard } from "../api/contracts";
import { session } from "../auth/session";
import { useApiResource } from "../composables/useApiResource";
import { useMatchRequest } from "../composables/useMatchRequest";
import { leaderboardBlurb } from "../games/leaderboard";
import ParticipantTags from "../components/ParticipantTags.vue";
import PaginationControls from "../components/PaginationControls.vue";
import AppButton from "../components/ui/AppButton.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const props = defineProps<{
  game: GameCatalogEntry;
  /** The page around it already shows the title and description. */
  headless?: boolean;
}>();

const route = useRoute();
const router = useRouter();
const page = computed(() => clampMatchPage(Number(route.query.page ?? 1)));
const { data, status, empty, error, refreshError, pending, reload } = useApiResource(
  () => `/api/games/${encodeURIComponent(props.game.id)}/leaderboard?page=${page.value}&limit=20`,
  parseLeaderboard,
  {
    isEmpty: (value) => value.players.length === 0,
    // Live: every 10 s while visible, immediately when the tab becomes visible again.
    pollWhen: () => true,
    pollInterval: 10000,
    notify: false,
  },
);
const arena = computed(() => !!props.game.arena);
const solo = computed(() => isSoloGame(props.game));
const challengeable = computed(() => !arena.value && !solo.value && !!session.user);
const match = useMatchRequest(() => props.game.id);
const podium = computed(() => (data.value?.page === 1 ? data.value.players.slice(0, 3) : []));

function record(p: LeaderboardPlayer) {
  if (solo.value) return `${p.matchesPlayed} 次挑战`;
  if (!arena.value) return `${p.matchesPlayed} 场 · ${p.wins} 胜 ${p.draws} 平 ${p.losses} 负`;
  const average = p.matchesPlayed ? (p.placementTotal / p.matchesPlayed).toFixed(1) : "—";
  return `${p.matchesPlayed} 场 · ${p.wins} 冠 · 平均第 ${average} 名`;
}
function score(p: LeaderboardPlayer) {
  if (solo.value) return p.bestScore.toLocaleString();
  return p.rating.toFixed(2);
}
function rankClass(rank: number) {
  return rank <= 3 ? "text-accent" : rank <= 5 ? "text-ink" : "text-soft";
}
function change(value: number) {
  void router.push({ query: { ...route.query, page: value } });
}
defineExpose({ refresh: reload });
</script>

<template>
  <div class="@container space-y-4">
    <header v-if="!headless" class="space-y-1">
      <h2 class="text-xl font-bold">排行榜</h2>
      <p class="text-[13px] leading-6 text-soft">{{ leaderboardBlurb(game) }}</p>
    </header>
    <StateBlock v-if="status === 'loading'" status="loading" />
    <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
    <StateBlock v-else-if="empty" status="empty" message="还没有排名，成为第一位参赛者。" />
    <template v-else-if="data">
      <ol class="hidden gap-3.5 @2xl:grid @2xl:grid-cols-3" aria-label="前三名">
        <li
          v-for="p in podium"
          :key="p.userId"
          class="podium-card card flex flex-col gap-2.5 p-5"
          :style="{
            '--panel-accent': p.rank === 1 ? '#ffd27d' : p.rank === 2 ? '#75d5ff' : '#bd9aff',
          }"
          :class="{ 'border-accent-line': p.rank === 1 }"
        >
          <span
            class="figure text-[40px] leading-none"
            :class="p.rank === 1 ? 'text-accent' : 'text-ink'"
            >{{ p.rank }}</span
          >
          <span class="truncate text-lg font-bold">{{ p.username }}</span>
          <span class="flex items-baseline justify-between gap-2 text-[13px] text-soft"
            ><span class="min-w-0">{{ record(p) }}</span
            ><b class="figure text-lg text-ink">{{ score(p) }}</b></span
          >
        </li>
      </ol>
      <div class="card overflow-hidden">
        <table class="leaderboard-table w-full text-left text-sm">
          <caption class="sr-only">
            {{
              game.name
            }}{{
              solo ? "排行榜，按单人最高得分排序" : "排行榜，按排位分排序"
            }}
          </caption>
          <thead class="text-[13px] text-faint">
            <tr>
              <th scope="col" class="w-12 py-3.5 pr-2 pl-4 font-medium @lg:w-16 @lg:pl-5">#</th>
              <th scope="col" class="px-2 py-3.5 font-medium">选手</th>
              <th scope="col" class="hidden px-2 py-3.5 font-medium @lg:table-cell">战绩</th>
              <th scope="col" class="py-3.5 pr-4 pl-2 text-right font-medium @lg:pr-5">
                {{ solo ? "最高分" : "排位分" }}
              </th>
              <th v-if="challengeable" scope="col" class="w-0 py-3.5 pr-4 @lg:pr-5">
                <span class="sr-only">挑战</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in data.players"
              :key="p.userId"
              class="border-t border-divider"
              :class="{ 'bg-accent/7': p.userId === session.user?.id }"
            >
              <td class="figure py-3.5 pr-2 pl-4 text-[17px] @lg:pl-5" :class="rankClass(p.rank)">
                {{ p.rank }}
              </td>
              <td class="min-w-0 px-2 py-3.5">
                <span class="flex flex-wrap items-center gap-1.5 font-semibold break-all"
                  >{{ p.username }} <ParticipantTags :player="p"
                /></span>
                <span class="mt-0.5 block font-mono text-xs text-faint @lg:hidden">{{
                  record(p)
                }}</span>
              </td>
              <td class="hidden px-2 py-3.5 font-mono text-[13px] text-soft @lg:table-cell">
                {{ record(p) }}
              </td>
              <td class="figure py-3.5 pr-4 pl-2 text-right text-[17px] @lg:pr-5">
                {{ score(p) }}
              </td>
              <td v-if="challengeable" class="py-2 pr-4 text-right @lg:pr-5">
                <AppButton
                  v-if="p.userId !== session.user?.id"
                  size="sm"
                  :aria-label="`挑战 ${p.username}`"
                  :loading="match.pending.value && match.body.value?.opponentId === p.userId"
                  :disabled="match.pending.value"
                  @click="match.start({ opponentId: p.userId })"
                  >挑战</AppButton
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="challengeable" class="text-xs text-faint">挑战是练习赛，不改变双方排位分。</p>
      <PaginationControls
        :page="data.page"
        :limit="data.limit"
        :total="data.total"
        :pending="pending"
        @change="change"
      />
    </template>
    <p v-if="refreshError" role="alert" class="text-sm text-danger-ink">
      {{ refreshError }} <AppButton size="sm" variant="link" @click="reload">重新加载</AppButton>
    </p>
  </div>
</template>
