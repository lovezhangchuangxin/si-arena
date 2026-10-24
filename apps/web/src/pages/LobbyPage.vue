<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { parseHistory, parseLeaderboard } from "../api/contracts";
import { session } from "../auth/session";
import { useApiResource } from "../composables/useApiResource";
import { duelGames, useCatalog } from "../games/catalog";
import { isSoloGame } from "@si-arena/protocol";
import LobbyGameCard from "../components/lobby/LobbyGameCard.vue";
import LobbyIcon from "../components/lobby/LobbyIcon.vue";
import MatchList from "../components/MatchList.vue";
import AppButton from "../components/ui/AppButton.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const catalog = useCatalog();
const games = computed(() => catalog.data.value?.games ?? []);
// Secondary ranking and history panels follow the first head-to-head game.
const duel = computed(() => duelGames(games.value)[0]);
const query = ref("");
const mode = ref("all");
const modes = [
  { id: "all", label: "全部游戏", icon: "grid" },
  { id: "duel", label: "双人对抗", icon: "duel" },
  { id: "arena", label: "多人竞技场", icon: "arena" },
  { id: "solo", label: "单人挑战", icon: "chart" },
] as const;
const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return games.value.filter((game) => {
    const gameMode = game.arena ? "arena" : isSoloGame(game) ? "solo" : "duel";
    return (
      (mode.value === "all" || mode.value === gameMode) &&
      `${game.id} ${game.name} ${game.description}`.toLocaleLowerCase().includes(term)
    );
  });
});
function resetFilters() {
  query.value = "";
  mode.value = "all";
}
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
  <div class="lobby">
    <section class="lobby-hero" aria-labelledby="lobby-title">
      <div class="lobby-hero-art" aria-hidden="true"></div>
      <div class="lobby-hero-copy">
        <h1 id="lobby-title">下一场，交给你的<span>代码。</span></h1>
        <p class="lobby-intro">用 AI 编写策略，上传你的选手，在对战与回放中不断进步。</p>
        <div class="lobby-features">
          <div>
            <i><LobbyIcon name="bolt" /></i><span><b>多种游戏环境</b></span>
          </div>
          <div>
            <i><LobbyIcon name="duel" /></i><span><b>策略同场竞技</b></span>
          </div>
          <div>
            <i><LobbyIcon name="chart" /></i><span><b>独立游戏榜单</b></span>
          </div>
          <div>
            <i><LobbyIcon name="replay" /></i><span><b>完整对局回放</b></span>
          </div>
        </div>
      </div>
    </section>

    <section class="lobby-directory" aria-labelledby="modes-title">
      <h2 id="modes-title" class="sr-only">全部游戏与玩法</h2>
      <div class="lobby-toolbar">
        <div class="lobby-filters" role="group" aria-label="按参赛模式筛选">
          <button
            v-for="item in modes"
            :key="item.id"
            type="button"
            :aria-pressed="mode === item.id"
            :class="{ 'is-active': mode === item.id }"
            @click="mode = item.id"
          >
            <LobbyIcon :name="item.icon" />{{ item.label }}
          </button>
        </div>
        <label class="lobby-search">
          <LobbyIcon name="search" /><span class="sr-only">搜索游戏</span>
          <input v-model="query" type="search" placeholder="搜索游戏、玩法或关键词…" />
        </label>
      </div>
      <StateBlock v-if="catalog.status.value === 'loading'" status="loading" />
      <StateBlock
        v-else-if="catalog.status.value === 'error'"
        status="error"
        :message="catalog.error.value"
        @retry="catalog.reload"
      />
      <StateBlock v-else-if="!games.length" status="empty" message="暂时还没有可玩的游戏。" />
      <div v-else-if="!filtered.length" class="lobby-empty" role="status">
        <p>没有找到匹配的游戏，试试其他关键词或参赛模式。</p>
        <AppButton @click="resetFilters">重置筛选</AppButton>
      </div>
      <div v-else class="lobby-game-grid">
        <LobbyGameCard v-for="game in filtered" :key="game.id" :game="game" />
      </div>
      <p v-if="catalog.status.value === 'ready'" class="sr-only" role="status" aria-live="polite">
        共 {{ filtered.length }} 款符合条件的游戏
      </p>
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
