<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { parseHistory, parseLeaderboard } from "../api/contracts";
import { session } from "../auth/session";
import { useApiResource } from "../composables/useApiResource";
import { duelGames, useCatalog } from "../games/catalog";
import { isSoloGame } from "@si-arena/protocol";
import ArenaModeCard from "../components/lobby/ArenaModeCard.vue";
import DuelModeCard from "../components/lobby/DuelModeCard.vue";
import SoloModeCard from "../components/lobby/SoloModeCard.vue";
import GamePreview from "../components/GamePreview.vue";
import MatchList from "../components/MatchList.vue";
import AppButton from "../components/ui/AppButton.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const catalog = useCatalog();
const games = computed(() => catalog.data.value?.games ?? []);
// The hero and the ranking tiles follow the first head-to-head game, the mode grid lists them all.
const duel = computed(() => duelGames(games.value)[0]);
const featured = computed(() => duel.value ?? games.value[0]);
const duelApi = computed(() =>
  duel.value ? `/api/games/${encodeURIComponent(duel.value.id)}` : null,
);
const top = useApiResource(
  () => (duelApi.value ? `${duelApi.value}/leaderboard?page=1&limit=5` : null),
  parseLeaderboard,
  { notify: false, isEmpty: (value) => value.players.length === 0 },
);
const recent = useApiResource(
  () => (duelApi.value ? `${duelApi.value}/me/matches?page=1&limit=4` : null),
  parseHistory,
  { authenticated: true, notify: false, isEmpty: (value) => value.total === 0 },
);
</script>

<template>
  <div class="flex flex-col gap-10 pt-4 pb-6 sm:pt-6">
    <section class="flex flex-wrap items-center gap-10">
      <div class="flex min-w-0 flex-[999_1_32rem] flex-col gap-5">
        <p class="eyebrow">SUPER INTELLIGENCE ARENA</p>
        <h1 class="text-[40px] leading-[1.15] font-black sm:text-[52px]">
          让 AI 写的代码<br />替你上场
        </h1>
        <p class="max-w-[35rem] text-[17px] leading-[1.7] text-soft">
          在本地用任意 AI 编写 JavaScript 选手，上传后主动匹配。比赛在服务器上完整跑完，每一 tick
          的动作、错误和 CPU 都能在回放里查到。
        </p>
        <div class="flex flex-wrap gap-3 pt-2">
          <AppButton
            v-if="featured"
            variant="primary"
            size="lg"
            class="text-base"
            :to="`/games/${encodeURIComponent(featured.id)}`"
          >
            进入{{ featured.name }}
            <svg
              class="size-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </AppButton>
          <AppButton size="lg" class="text-base" href="#modes-title">全部玩法</AppButton>
        </div>
      </div>
      <GamePreview
        v-if="featured"
        class="min-w-0 flex-[1_1_22.5rem]"
        :game="featured"
        :fit="false"
      />
    </section>

    <section aria-labelledby="modes-title" class="flex flex-col gap-4">
      <h2 id="modes-title" class="text-xl font-bold">玩法</h2>
      <StateBlock v-if="catalog.status.value === 'loading'" status="loading" />
      <StateBlock
        v-else-if="catalog.status.value === 'error'"
        status="error"
        :message="catalog.error.value"
        @retry="catalog.reload"
      />
      <StateBlock v-else-if="!games.length" status="empty" message="暂时还没有可玩的游戏。" />
      <div v-else class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-5">
        <template v-for="game in games" :key="game.id">
          <ArenaModeCard v-if="game.arena" :game="game" />
          <SoloModeCard v-else-if="isSoloGame(game)" :game="game" />
          <DuelModeCard v-else :game="game" />
        </template>
      </div>
    </section>

    <section v-if="duel" class="flex flex-wrap gap-5">
      <div class="card flex min-w-0 flex-[1_1_26rem] flex-col gap-3.5 p-6">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-lg font-bold">{{ duel.name }} 排行前 5</h2>
          <RouterLink class="link text-sm" :to="{ path: '/leaderboard', query: { game: duel.id } }"
            >完整排行榜</RouterLink
          >
        </div>
        <StateBlock v-if="top.status.value === 'loading'" status="loading" />
        <StateBlock
          v-else-if="top.status.value === 'error'"
          status="error"
          :message="top.error.value"
          @retry="top.reload"
        />
        <p v-else-if="top.empty.value" class="py-4 text-sm text-soft">
          还没有排名，成为第一位参赛者。
        </p>
        <ol v-else class="divide-y divide-divider">
          <li
            v-for="p in top.data.value?.players ?? []"
            :key="p.userId"
            class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] items-center gap-3 px-1 py-3"
          >
            <span
              class="figure text-lg"
              :class="p.rank === 1 ? 'text-accent' : p.rank <= 3 ? 'text-ink' : 'text-soft'"
              >{{ p.rank }}</span
            >
            <span class="truncate font-medium">{{ p.username }}</span>
            <span class="font-mono text-[13px] text-soft">{{ p.wins }}胜 {{ p.losses }}负</span>
            <span class="figure text-lg">{{ p.rating.toFixed(0) }}</span>
          </li>
        </ol>
      </div>
      <div class="card flex min-w-0 flex-[1_1_26rem] flex-col gap-3.5 p-6">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-lg font-bold">我最近的比赛</h2>
          <RouterLink
            v-if="session.user"
            class="link text-sm"
            :to="`/games/${encodeURIComponent(duel.id)}/matches`"
            >全部记录</RouterLink
          >
        </div>
        <p v-if="session.ready && !session.user" class="py-4 text-sm text-soft">
          <RouterLink class="link" :to="{ path: '/login', query: { next: '/' } }">登录</RouterLink>
          后在这里看到你最近的比赛。
        </p>
        <StateBlock v-else-if="recent.status.value === 'loading'" status="loading" />
        <StateBlock
          v-else-if="recent.status.value === 'error'"
          status="error"
          :message="recent.error.value"
          @retry="recent.reload"
        />
        <p v-else-if="recent.empty.value" class="py-4 text-sm text-soft">
          还没有比赛，上传策略后发起匹配。
        </p>
        <MatchList v-else :matches="recent.data.value?.matches ?? []" />
      </div>
    </section>

    <footer
      class="flex flex-wrap justify-between gap-3 border-t border-divider pt-5 text-[13px] text-faint"
    >
      <span>SI Arena · 平台不接入模型 API，也不验证代码由谁生成</span>
      <span v-if="duel" class="font-mono"
        >npx @si-arena/cli@latest init {{ duel.id }} ./{{ duel.id }}-bot</span
      >
    </footer>
  </div>
</template>
