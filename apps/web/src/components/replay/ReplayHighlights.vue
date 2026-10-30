<script setup lang="ts">
import { computed } from "vue";
import type { ReplayHighlight } from "@si-arena/player/browser";

/** The game's notable moments up to the shown tick, newest first; each one seeks the replay. */
const props = defineProps<{ highlights: readonly ReplayHighlight[]; tick: number }>();
const emit = defineEmits<{ seek: [tick: number] }>();
const shown = computed(() =>
  props.highlights.filter((highlight) => highlight.tick <= props.tick).toReversed(),
);
</script>

<template>
  <section class="card p-5" aria-labelledby="replay-highlights">
    <h3 id="replay-highlights" class="text-base font-bold">战况</h3>
    <p v-if="!shown.length" class="mt-3 text-sm text-faint">还没有淘汰或缩圈。</p>
    <ol v-else class="mt-3 max-h-72 space-y-1 overflow-y-auto">
      <li v-for="(highlight, index) in shown" :key="`${highlight.tick}-${index}`">
        <button
          type="button"
          class="grid min-h-11 w-full grid-cols-[4rem_minmax(0,1fr)] items-start gap-2.5 rounded-control px-2 py-1.5 text-left text-sm leading-6 transition hover:bg-subtle"
          @click="emit('seek', highlight.tick)"
        >
          <span class="pt-0.5 font-mono text-xs text-faint">t {{ highlight.tick }}</span>
          <span
            :class="{
              'text-danger-ink': highlight.tone === 'danger',
              'text-soft': highlight.tone === 'neutral',
              'text-[#f87171]': highlight.tone === 'up',
              'text-[#34d399]': highlight.tone === 'down',
            }"
            >{{ highlight.text }}</span
          >
        </button>
      </li>
    </ol>
  </section>
</template>
