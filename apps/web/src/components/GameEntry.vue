<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { isSoloGame } from "@si-arena/protocol";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { parseGameMe, parseMatch } from "../api/contracts";
import { useApiResource } from "../composables/useApiResource";
import { useMatchRequest } from "../composables/useMatchRequest";
import { useStrategyUpload } from "../composables/useStrategyUpload";
import type { useArena } from "../composables/useArena";
import { gameMatchLocation } from "../games/locations";
import { shortTime } from "../utils/time";
import AppBadge from "./ui/AppBadge.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const props = defineProps<{
  game: GameCatalogEntry;
  compact?: boolean;
  arena?: ReturnType<typeof useArena>;
}>();
const solo = computed(() => isSoloGame(props.game));
const route = useRoute();
const router = useRouter();
let refreshQueued = false;
const me = useApiResource(() => `/api/games/${encodeURIComponent(props.game.id)}/me`, parseGameMe, {
  authenticated: true,
  notify: false,
});
const { data, status, error, refreshError, reload } = me;
const active = useApiResource(
  () =>
    data.value?.activeMatch && route.query.match !== data.value.activeMatch.id
      ? `/api/matches/${encodeURIComponent(data.value.activeMatch.id)}`
      : null,
  parseMatch,
  { pollWhen: (match) => match.status === "pending" || match.status === "running", notify: false },
);
watch(
  () => active.data.value?.status,
  (value) => {
    if (value === "completed" || value === "failed") void refresh();
  },
);
const match = useMatchRequest(() => props.game.id);
const upload = useStrategyUpload({
  game: () => props.game,
  me,
  blocked: () => match.pending.value || !!props.arena?.starting.value,
  onAccepted: () => {
    match.error.value = "";
    if (props.game.arena) void props.arena?.status.reload();
  },
});
const { busy, uncertain, fileError, feedback, candidate } = upload;
watch(
  () => data.value?.activeMatch?.id,
  (id) => {
    if (id && route.path === gameMatchLocation(props.game.id).path && !route.query.match)
      void router.replace(gameMatchLocation(props.game.id, id));
  },
);
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const arenaActive = computed(() => props.arena?.status.data.value?.active);
const arenaStarting = computed(() => !!props.arena?.starting.value);
const working = computed(() => !!busy.value || match.pending.value || arenaStarting.value);
const locked = computed(() => working.value || uncertain.value);
watch([busy, match.pending, uncertain, arenaStarting], () => {
  if (
    !working.value &&
    !uncertain.value &&
    (refreshQueued ||
      (data.value?.activeMatch &&
        (active.data.value?.status === "completed" || active.data.value?.status === "failed")))
  )
    void refresh();
});
const disabledReason = computed(
  () =>
    ({
      NO_CODE: "先上传策略",
      PROTOCOL_MISMATCH: "接口已升级，请按当前 SDK 更新策略。",
      CODE_TOO_LARGE: "当前策略超过代码大小限制，请重新上传。",
    })[data.value?.cannotMatchReason ?? "NO_CODE"],
);
const bossBusy = computed(() => match.pending.value && match.body.value?.boss === true);

async function refresh() {
  // A match request refreshes once its POST/navigation has finished.
  if (match.pending.value || arenaStarting.value) return;
  if (busy.value || uncertain.value) {
    refreshQueued = true;
    return;
  }
  refreshQueued = false;
  await reload();
  if (data.value?.activeMatch && (active.error.value || active.refreshError.value))
    await active.reload();
}
watch(
  () => route.fullPath,
  () => void refresh(),
);
onMounted(() => window.addEventListener("focus", refresh));
onUnmounted(() => window.removeEventListener("focus", refresh));

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void upload.read(file);
}
function dropFile(event: DragEvent) {
  dragging.value = false;
  const files = event.dataTransfer?.files;
  if (!files?.length || locked.value) return;
  if (files.length !== 1) {
    fileError.value = "每次只能上传一个策略文件。";
    return;
  }
  void upload.read(files[0]!);
}
async function startArena() {
  const arena = props.arena;
  if (!arena || !data.value?.canMatch || locked.value || arenaActive.value) return;
  if (await arena.start()) {
    const run = arena.startedMatch.value;
    if (run) await router.push(gameMatchLocation(props.game.id, run.id));
    await refresh();
  }
}
async function startMatch(boss = false) {
  if (data.value?.canMatch && !locked.value && (await match.start(boss ? { boss: true } : {})))
    await refresh();
}
defineExpose({ refresh, data });
</script>

<template>
  <StateBlock v-if="status === 'loading'" status="loading" />
  <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
  <section
    v-else-if="data"
    aria-label="我的参赛策略"
    class="flex min-w-0 flex-col gap-3 transition"
    :class="[compact ? 'p-4 sm:px-5' : 'card p-4', { 'bg-accent-soft': dragging }]"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="dropFile"
  >
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-soft">
      <span class="flex items-baseline gap-2">
        {{ solo ? "历史最高分" : "排位" }}
        <b class="figure text-xl text-ink">{{
          solo ? data.entry.bestScore.toLocaleString() : data.entry.rating.toFixed(2)
        }}</b>
      </span>
      <span v-if="solo">已挑战 {{ data.entry.matchesPlayed }} 次</span>
      <span v-else-if="game.arena"
        >已赛 {{ data.entry.matchesPlayed }} 场 · 冠军 {{ data.entry.wins }} 次</span
      >
      <span v-else
        >{{ data.entry.wins }} 胜 {{ data.entry.draws }} 平 {{ data.entry.losses }} 负 · 已赛
        {{ data.entry.matchesPlayed }} 场</span
      >
    </div>
    <div
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
      :class="dragging ? 'rounded-control bg-accent-soft p-2 ring-1 ring-accent' : ''"
      aria-live="polite"
    >
      <span class="text-soft">当前策略</span>
      <AppBadge v-if="uncertain" tone="warning">上传结果待确认</AppBadge>
      <AppBadge v-else-if="busy">{{
        busy === "read" ? "读取文件中" : busy === "verify" ? "核实上传结果中" : "上传并校验中"
      }}</AppBadge>
      <AppBadge v-else-if="data.canMatch" tone="accent">可参赛</AppBadge>
      <AppBadge v-else :tone="data.code ? 'warning' : 'neutral'">{{
        data.code ? "需要更新" : "尚未上传"
      }}</AppBadge>
      <span v-if="data.code" class="font-mono text-faint"
        >{{ (data.code.sourceBytes / 1024).toFixed(1) }} KiB</span
      >
      <time
        v-if="data.code"
        :datetime="data.code.updatedAt"
        class="ml-auto text-faint"
        :title="`策略更新于 ${shortTime(data.code.updatedAt)}`"
        >{{ shortTime(data.code.updatedAt) }}</time
      >
      <span v-if="feedback && !busy" class="text-accent">{{ feedback }}</span>
      <span v-if="dragging" class="text-accent">松开以上传策略</span>
    </div>
    <p v-if="!data.canMatch" class="text-xs text-soft">{{ disabledReason }}</p>
    <p
      v-else-if="
        game.arena &&
        !arenaActive &&
        arena?.status.data.value &&
        arena.status.data.value.lineup.length < game.minPlayers
      "
      class="text-xs text-warning"
    >
      至少需要 {{ game.minPlayers }} 名可参赛选手，当前阵容人数不足。
    </p>
    <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-2.5">
      <input
        ref="fileInput"
        id="strategy-file"
        class="sr-only"
        type="file"
        accept=".js,.mjs,text/javascript,application/javascript"
        tabindex="-1"
        aria-label="上传策略文件"
        :disabled="locked"
        @change="selectFile"
      />
      <AppButton
        size="lg"
        :variant="data.code ? 'secondary' : 'primary'"
        :loading="!!busy"
        :disabled="locked"
        @click="fileInput?.click()"
        :title="data.code ? '选择 .js 文件，或拖入文件更新策略' : '选择本地编写的 .js 策略文件'"
        >{{ data.code ? "更新策略" : "上传策略" }}</AppButton
      >
      <AppButton
        v-if="game.arena && arenaActive"
        size="lg"
        variant="primary"
        :disabled="locked"
        :to="gameMatchLocation(game.id, arenaActive.id)"
        >查看当前比赛</AppButton
      >
      <AppButton
        v-else-if="game.arena"
        size="lg"
        :variant="data.code ? 'primary' : 'secondary'"
        :loading="arenaStarting"
        :disabled="
          !data.canMatch ||
          locked ||
          !arena?.status.data.value ||
          arena.status.data.value.lineup.length < game.minPlayers
        "
        @click="startArena"
        >开一局</AppButton
      >
      <AppButton
        v-else-if="data.activeMatch"
        size="lg"
        variant="primary"
        :disabled="locked"
        :to="gameMatchLocation(game.id, data.activeMatch.id)"
        >查看当前比赛</AppButton
      >
      <AppButton
        v-else
        size="lg"
        :variant="data.code ? 'primary' : 'secondary'"
        :loading="match.pending.value && !bossBusy"
        :disabled="!data.canMatch || locked"
        @click="startMatch()"
        >{{ solo ? "开始挑战" : "发起匹配" }}</AppButton
      >
    </div>
    <div
      v-if="data.boss.available && !game.arena"
      class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[13px] text-soft"
    >
      <span
        >Boss 战绩
        <span class="font-mono text-ink"
          >{{ data.boss.wins }} 胜 / {{ data.boss.attempts }} 次</span
        ></span
      >
      <AppButton
        size="sm"
        variant="danger"
        :loading="bossBusy"
        :disabled="!data.canMatch || !!data.activeMatch || locked"
        @click="startMatch(true)"
        >挑战 Boss</AppButton
      >
    </div>
    <div
      v-if="fileError || uncertain"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3"
    >
      <p role="alert" class="min-w-0 text-sm break-words text-danger-ink">
        {{ fileError || "正在确认上传结果。" }}
      </p>
      <AppButton v-if="uncertain" size="sm" :disabled="working" @click="upload.verify"
        >核实状态</AppButton
      >
      <AppButton v-if="candidate !== null" size="sm" :disabled="working" @click="upload.upload"
        >重试上传</AppButton
      >
    </div>
    <div
      v-if="refreshError || active.refreshError.value || active.error.value"
      class="flex flex-wrap items-center gap-3 text-xs text-danger-ink"
      role="alert"
    >
      {{ refreshError || active.refreshError.value || active.error.value }}
      <AppButton size="sm" variant="link" :disabled="working" @click="refresh"
        >刷新参赛状态</AppButton
      >
    </div>
    <p v-if="game.arena && arena?.error.value" role="alert" class="text-sm text-danger-ink">
      {{ arena.error.value }}
    </p>
    <p v-if="match.error.value" role="alert" class="text-sm text-danger-ink">
      {{ match.error.value }}
    </p>
    <details v-if="data.code && !compact" class="border-t border-line pt-2">
      <summary class="w-fit cursor-pointer py-1 text-xs text-soft">查看当前代码</summary>
      <pre class="code-block mt-2 max-h-80">{{ data.code.source }}</pre>
    </details>
  </section>
</template>
