<script setup lang="ts">
import { computed } from "vue";
import { useToast } from "../../composables/useToast";

const { current, dismiss } = useToast();

const accents = {
  info: "bg-soft",
  success: "bg-accent",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

const live = computed(() => (current.value?.tone === "danger" ? "assertive" : "polite"));
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3 sm:pt-5"
    :aria-live="live"
    role="status"
  >
    <Transition name="toast">
      <div
        v-if="current"
        class="toast-surface pointer-events-auto flex w-full max-w-[30rem] items-start gap-3 rounded-panel border border-line-strong bg-subtle px-4 py-3 shadow-pop"
      >
        <!-- 圆点、关闭图标都放进与正文同样的 24px 行盒里居中，三者才真正对齐 -->
        <span class="flex h-6 shrink-0 items-center" aria-hidden="true">
          <span class="size-2 rounded-full" :class="accents[current.tone]" />
        </span>
        <p class="min-w-0 flex-1 text-sm leading-6 text-ink">{{ current.message }}</p>
        <button
          type="button"
          class="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-chip text-faint transition hover:bg-line hover:text-ink"
          aria-label="关闭提示"
          @click="dismiss"
        >
          <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>
