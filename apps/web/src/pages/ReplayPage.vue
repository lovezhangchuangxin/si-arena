<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import {
  loadRegisteredReplay,
  readBrowserReplay,
  type BrowserReplaySession,
} from "@si-arena/player/browser";
import { replayGames } from "../games/replays";
import ReplayViewer from "../components/ReplayViewer.vue";
import { downloadReplay } from "../api/replay";
import AppBadge from "../components/ui/AppBadge.vue";
import AppButton from "../components/ui/AppButton.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const props = withDefaults(defineProps<{ initialReplayUrl?: string; exampleCommand?: string }>(), {
  exampleCommand: "pnpm arena run --bot ./games/paper/bots/official.js --seed 42",
});

const session = shallowRef<BrowserReplaySession | null>(null);
const pending = ref(false),
  error = ref(""),
  fileName = ref(""),
  completed = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);
let loading: AbortController | undefined;
const progress = computed(() =>
  completed.value ? `已检查 ${completed.value} tick…` : "正在解压并校验回放…",
);
async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await load(file, file.name);
}
async function load(file: Blob | string, name: string) {
  loading?.abort();
  const controller = new AbortController();
  loading = controller;
  session.value = null;
  error.value = "";
  completed.value = 0;
  pending.value = true;
  fileName.value = name;
  try {
    const blob = typeof file === "string" ? await downloadReplay(file, controller.signal) : file;
    const raw = await readBrowserReplay(blob, controller.signal);
    const loaded = await loadRegisteredReplay(raw, replayGames, {
      signal: controller.signal,
      onProgress: (ticks) => {
        if (loading === controller) completed.value = ticks;
      },
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
    if (loading === controller && !controller.signal.aborted) session.value = loaded;
  } catch (cause) {
    if (loading === controller && !controller.signal.aborted)
      error.value = `无法播放这份回放：${cause instanceof Error ? cause.message : "文件读取失败"}`;
  } finally {
    if (loading === controller) pending.value = false;
  }
}
onMounted(() => {
  if (props.initialReplayUrl) void load(props.initialReplayUrl, "本地比赛.json.gz");
});
function cancelLoad() {
  loading?.abort();
  pending.value = false;
}
/** 错误态的“重新选择文件”要把系统文件选择器重新叫出来。 */
function reselectFile() {
  fileInput.value?.click();
}
onBeforeUnmount(() => loading?.abort());
</script>

<template>
  <section class="flex flex-col gap-5">
    <PageHeader title="本地回放">
      <p class="flex flex-wrap items-center gap-2.5 text-[13px] text-soft">
        <template v-if="session">
          <span class="font-mono break-all">{{ fileName }}</span>
          <AppBadge tone="accent">回放校验通过</AppBadge>
          <span class="font-mono text-faint"
            >{{ session.replay.game.release }} · {{ session.replay.matchId }}</span
          >
        </template>
        <span>文件只在浏览器里读取，不上传</span>
      </p>
      <template #actions>
        <input
          id="replay-file"
          ref="fileInput"
          class="peer sr-only"
          type="file"
          accept=".gz,.json.gz,application/gzip"
          @change="selectFile"
        />
        <label
          for="replay-file"
          class="app-button app-button--secondary inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong px-[1.125rem] text-sm font-medium text-ink transition hover:border-faint hover:bg-subtle peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
        >
          <svg
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h6l2 2h8v10H4z" />
          </svg>
          打开回放文件
        </label>
      </template>
    </PageHeader>

    <StateBlock v-if="pending" status="loading" :message="progress">
      <template #action>
        <AppButton size="sm" @click="cancelLoad">取消加载</AppButton>
      </template>
    </StateBlock>
    <StateBlock
      v-else-if="error"
      status="error"
      :message="error"
      action-label="重新选择文件"
      @retry="reselectFile"
    />
    <ReplayViewer v-else-if="session" :key="session.replay.matchId" :session="session" />
    <div v-else class="replay-empty card p-6 sm:p-8">
      <svg class="replay-file-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M13 5h15l9 9v29H13zM28 5v10h9" stroke="currentColor" stroke-width="2" />
        <path d="m21 22 9 6-9 6z" fill="currentColor" />
      </svg>
      <p class="font-bold text-ink">打开 .json.gz 回放文件</p>
      <p class="mt-1.5 text-sm leading-6 text-soft">文件仅在浏览器中读取和校验。</p>
      <p class="mt-6 text-sm text-soft">还没有回放？在项目根目录运行：</p>
      <pre class="code-block mt-2 text-accent"><code>{{ exampleCommand }}</code></pre>
    </div>
  </section>
</template>
