<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { session } from "../../auth/session";
import { useArena } from "../../composables/useArena";
import { gameArenaPath, gameMatchLocation } from "../../games/locations";
import { relativeTime } from "../../utils/time";
import AppButton from "../ui/AppButton.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const route = useRoute();
const router = useRouter();
const arena = useArena(() => props.game);
const status = arena.status.data;
const last = computed(() => status.value?.recent[0]);
const lastText = computed(() => {
  const run = last.value;
  if (!run) return "还没有开过局";
  if (run.status === "failed") return `上一局 ${relativeTime(run.updatedAt)}结束 · 系统失败`;
  const champion = run.participants
    .filter((p) => p.rank === 1)
    .map((p) => p.username)
    .join("、");
  return `上一局 ${relativeTime(run.updatedAt)}结束 · 冠军 ${champion || "—"}`;
});
async function start() {
  if (await arena.start()) {
    const run = arena.startedMatch.value;
    await router.push(
      run ? gameMatchLocation(props.game.id, run.id) : gameArenaPath(props.game.id),
    );
  }
}
</script>

<template>
  <article class="card flex flex-col gap-[1.125rem] border-accent-line p-6 sm:p-7">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-2xl font-bold">{{ game.name }} · 竞技场</h3>
      <span
        class="rounded-[0.375rem] border border-line-strong px-2 py-1 font-mono text-xs text-soft"
        >{{ game.arena?.seats }} 人 · {{ game.maxTicks }} tick</span
      >
    </div>
    <p class="text-[15px] leading-7 text-soft">
      {{ game.description }} 开局者必入场，排行榜前
      {{ (game.arena?.seats ?? 5) - 1 }} 名自动入选，全服同一时间只跑一局。
    </p>
    <div class="tile flex items-center gap-3.5 px-4 py-3.5" aria-live="polite">
      <span
        class="size-2.5 shrink-0 rounded-full"
        :class="
          status?.active
            ? 'bg-warning shadow-[0_0_0_4px_rgb(255_176_32/0.2)]'
            : 'bg-accent shadow-[0_0_0_4px_rgb(197_240_74/0.18)]'
        "
        aria-hidden="true"
      ></span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="font-bold">{{
          !status ? "正在读取竞技场…" : status.active ? "正在运行" : "竞技场空闲"
        }}</span>
        <span v-if="status" class="text-[13px] text-soft">{{
          status.active ? `${status.active.participants.length} 人正在对战` : lastText
        }}</span>
      </span>
    </div>
    <p v-if="arena.error.value" role="alert" class="text-sm text-danger-ink">
      {{ arena.error.value }}
    </p>
    <div class="mt-auto flex flex-wrap gap-2.5">
      <AppButton
        v-if="session.ready && !session.user"
        variant="primary"
        :to="{ path: '/login', query: { next: route.fullPath } }"
        >登录后开局</AppButton
      >
      <AppButton
        v-else
        variant="primary"
        :loading="arena.starting.value"
        :disabled="!status || !!status.active || status.lineup.length < 2"
        @click="start"
        >开一局</AppButton
      >
      <AppButton :to="gameArenaPath(game.id)">进入游戏</AppButton>
    </div>
  </article>
</template>
