<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { usePlayback } from "@si-arena/player";
import type { BrowserReplaySession, ReplayScene } from "@si-arena/player/browser";
import type { CubeScene } from "@si-arena/game-cube/renderer";
import GameCanvas from "./GameCanvas.vue";
import CubeStage from "./cube/CubeStage.vue";
import ReplayControls from "./replay/ReplayControls.vue";
import ReplayDiagnostics from "./replay/ReplayDiagnostics.vue";
import ReplayHighlights from "./replay/ReplayHighlights.vue";
import ReplayLogs from "./replay/ReplayLogs.vue";
import ReplayScoreboard from "./replay/ReplayScoreboard.vue";
import type { MemoryLoader } from "./replay/replay-diagnostics";

const props = defineProps<{
  session: BrowserReplaySession;
  sourceKind?: "online" | "file" | "live";
  /** Where the scoreboard and diagnostics go; rendered beside the map when absent. */
  detailsTarget?: HTMLElement | null;
  /** Fill the parent's height (the game workspace) instead of following the page flow. */
  fit?: boolean;
  memory?: MemoryLoader;
}>();
const source = shallowRef<BrowserReplaySession | null>(props.session);
watch(
  () => props.session,
  (value) => {
    source.value = value;
  },
);
const playback = usePlayback(
  source,
  {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  },
  // Playing frames redraw through the clock callback so event animations advance between ticks.
  { onFrame: draw },
);
const reducedMotionQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const { tick, playing } = playback;
const view = computed(() => props.session.view(tick.value));
const playerId = ref(props.session.replay.players.toSorted((a, b) => a.slot - b.slot)[0]!.id);
const logsAvailable = computed(
  () =>
    props.sourceKind !== "online" &&
    (props.memory !== undefined || props.sourceKind === "live" || props.session.hasLogs),
);
const surface = ref<InstanceType<typeof GameCanvas> | null>(null);
const canvasLabel = computed(
  () =>
    `比赛地图，已完成 ${tick.value} tick。${view.value.players.map((p) => `${p.label} 得分 ${p.score} ${props.session.scoreUnit}，${p.alive ? "存活" : "淘汰"}`).join("；")}`,
);
const state = computed(() =>
  tick.value === props.session.totalTicks ? "比赛结束" : playing.value ? "播放中" : "已暂停",
);
function draw() {
  surface.value?.redraw();
}
function motion() {
  return {
    progress: playback.progress.value,
    reducedMotion: reducedMotionQuery?.matches ?? false,
  };
}
function drawView(context: CanvasRenderingContext2D, width: number, height: number) {
  view.value.draw?.(context, width, height, motion());
}
// DOM-scene games declare their shape by `kind`; unknown kinds fall back to the canvas path.
const cubeScene = computed<(ReplayScene & CubeScene) | null>(() => {
  const scene = view.value.scene?.(motion());
  return scene?.kind === "cube" ? (scene as ReplayScene & CubeScene) : null;
});
// Seeks and source swaps redraw the settled world while paused; playing draws come from onFrame.
watch(
  view,
  () => {
    if (!playing.value) draw();
  },
  { flush: "post" },
);
function handleVisibility() {
  if (document.hidden) playback.pause();
}
onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibility);
  draw();
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibility);
});
function toggle() {
  if (playing.value) playback.pause();
  else playback.play();
}
function jumpError(direction: -1 | 1) {
  playback.jumpError(direction);
  const errors = view.value.record?.errors;
  if (errors && !Object.hasOwn(errors, playerId.value))
    playerId.value = Object.keys(errors)[0] ?? playerId.value;
}
function keyboard(event: KeyboardEvent) {
  if (
    event.target instanceof HTMLElement &&
    event.target.closest(
      "input,textarea,button,a,summary,[role=listbox],[role=option],[role=slider]",
    )
  )
    return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === " ") toggle();
  else if (event.key === "ArrowLeft") playback.step(-1);
  else if (event.key === "ArrowRight") playback.step(1);
  else if (event.key === "Home") playback.seek(0);
  else if (event.key === "End") playback.seek(props.session.totalTicks);
  else return;
  event.preventDefault();
}
</script>

<template>
  <section
    class="min-w-0"
    :class="fit ? 'replay--fit' : 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]'"
    aria-label="比赛回放"
    @keydown="keyboard"
  >
    <div class="replay-stage">
      <div class="replay-map card flex flex-col gap-2.5 p-3">
        <div
          class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1 font-mono text-[13px] text-soft"
        >
          <span data-testid="tick-count">已完成 {{ tick }} / {{ session.totalTicks }} tick</span>
          <span class="flex items-center gap-2">
            <span
              class="size-2 rounded-full"
              :class="playing ? 'bg-accent' : 'bg-soft'"
              aria-hidden="true"
            ></span
            >{{ state }}
          </span>
        </div>
        <CubeStage
          v-if="cubeScene"
          :scene="cubeScene"
          :aspect-ratio="session.aspectRatio"
          :label="canvasLabel"
          described-by="playback-help"
          :class="{ 'max-h-[min(72vh,52rem)]': !fit }"
        />
        <GameCanvas
          v-else
          ref="surface"
          described-by="playback-help"
          :class="{ 'max-h-[min(72vh,52rem)]': !fit }"
          :aspect-ratio="session.aspectRatio"
          :label="canvasLabel"
          :draw="drawView"
          :fit="fit"
        />
      </div>
      <ReplayControls
        :session="session"
        :playback="playback"
        @toggle="toggle"
        @jump-error="jumpError"
      />
    </div>
    <Teleport :to="detailsTarget ?? 'body'" :disabled="!detailsTarget">
      <aside class="min-w-0 space-y-4" aria-label="选手与诊断" @keydown="keyboard">
        <slot name="summary" />
        <ReplayScoreboard :session="session" :view="view" :tick="tick" />
        <ReplayHighlights
          v-if="session.highlights.length"
          :highlights="session.highlights"
          :tick="tick"
          @seek="playback.seek"
        />
        <ReplayDiagnostics
          v-model:player-id="playerId"
          :session="session"
          :view="view"
          :tick="tick"
          :memory="memory"
        />
        <ReplayLogs v-if="logsAvailable" :view="view" :player-id="playerId" />
        <p v-else-if="sourceKind !== 'online'" class="text-xs text-faint">此回放未包含玩家日志。</p>
      </aside>
    </Teleport>
  </section>
</template>
