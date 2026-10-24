<script setup lang="ts">
withDefaults(
  defineProps<{
    status: "loading" | "empty" | "error";
    message?: string | undefined;
    actionLabel?: string | undefined;
  }>(),
  { actionLabel: "重新加载" },
);

defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="state-block">
    <div
      v-if="status === 'loading'"
      role="status"
      aria-live="polite"
      class="rounded-panel border border-line bg-surface p-5"
    >
      <span class="sr-only">正在加载…</span>
      <p v-if="message" class="text-sm text-soft">{{ message }}</p>
      <div class="space-y-2.5" :class="message ? 'mt-3' : ''" aria-hidden="true">
        <div class="h-3 w-2/5 animate-pulse rounded-full bg-subtle"></div>
        <div class="h-3 w-4/5 animate-pulse rounded-full bg-subtle"></div>
        <div class="h-3 w-3/5 animate-pulse rounded-full bg-subtle"></div>
      </div>
      <div v-if="$slots.action" class="mt-4 flex justify-center">
        <slot name="action" />
      </div>
    </div>
    <div
      v-else-if="status === 'error'"
      role="alert"
      class="rounded-panel border border-danger-line bg-danger-soft p-5"
    >
      <p class="text-sm leading-6 text-danger-ink">{{ message || "加载失败，请重试。" }}</p>
      <button
        type="button"
        class="app-button app-button--secondary touch-target mt-4 inline-flex min-h-10 items-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition hover:border-faint"
        @click="$emit('retry')"
      >
        {{ actionLabel }}
      </button>
    </div>
    <div v-else class="rounded-panel border border-line bg-surface p-8 text-center">
      <p class="text-sm leading-6 text-soft">{{ message || "暂无内容。" }}</p>
      <div v-if="$slots.action" class="mt-4 flex justify-center">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>
