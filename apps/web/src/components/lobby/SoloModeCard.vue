<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { parseGameMe } from "../../api/contracts";
import { session } from "../../auth/session";
import { useApiResource } from "../../composables/useApiResource";
import { useMatchRequest } from "../../composables/useMatchRequest";
import AppButton from "../ui/AppButton.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const { data, status, reload } = useApiResource(
  () => `/api/games/${encodeURIComponent(props.game.id)}/me`,
  parseGameMe,
  {
    authenticated: true,
    notify: false,
  },
);
const match = useMatchRequest(() => props.game.id);
</script>

<template>
  <article class="card flex flex-col gap-[1.125rem] p-6 sm:p-7">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-2xl font-bold">{{ game.name }} · 单人挑战</h3>
      <span
        class="rounded-[0.375rem] border border-line-strong px-2 py-1 font-mono text-xs text-soft"
        >单人 · {{ game.maxTicks }} tick</span
      >
    </div>
    <p class="text-[15px] leading-7 text-soft">
      {{ game.description }} 每次挑战独立开局，随时重跑刷新纪录。
    </p>
    <template v-if="session.user">
      <p v-if="status === 'error'" class="text-sm text-soft">
        暂时读不到你的战绩。<AppButton size="sm" variant="link" @click="reload">重试</AppButton>
      </p>
      <dl v-else class="grid grid-cols-3 gap-3">
        <div class="tile p-3.5">
          <dt class="text-xs text-faint">最高分</dt>
          <dd class="figure mt-1.5 text-[26px]">
            {{ data ? data.entry.bestScore.toLocaleString() : "—" }}
          </dd>
        </div>
        <div class="tile p-3.5">
          <dt class="text-xs text-faint">排名</dt>
          <dd class="figure mt-1.5 text-[26px]">
            {{ data && data.entry.rank ? `#${data.entry.rank}` : "—" }}
          </dd>
        </div>
        <div class="tile p-3.5">
          <dt class="text-xs text-faint">挑战次数</dt>
          <dd class="figure mt-1.5 text-[26px]">{{ data ? data.entry.matchesPlayed : "—" }}</dd>
        </div>
      </dl>
      <div class="flex flex-wrap gap-3">
        <AppButton v-if="data?.activeMatch" :to="`/matches/${data.activeMatch.id}`"
          >查看进行中的挑战</AppButton
        >
        <AppButton
          v-else
          variant="primary"
          :loading="match.pending.value"
          :disabled="!data?.canMatch"
          @click="match.start()"
          >开始挑战</AppButton
        >
        <AppButton variant="ghost" :to="`/leaderboard?game=${encodeURIComponent(game.id)}`"
          >排行榜</AppButton
        >
      </div>
      <p v-if="data && !data.canMatch" class="text-sm text-soft">
        {{
          data.cannotMatchReason === "NO_CODE" ? "上传代码后开始挑战" : "代码需要重新上传后才能挑战"
        }}
      </p>
    </template>
    <template v-else>
      <div class="flex flex-wrap gap-3">
        <AppButton :to="{ path: '/login', query: { redirect: $route.fullPath } }"
          >登录后挑战</AppButton
        >
        <AppButton variant="ghost" :to="`/leaderboard?game=${encodeURIComponent(game.id)}`"
          >排行榜</AppButton
        >
      </div>
    </template>
  </article>
</template>
