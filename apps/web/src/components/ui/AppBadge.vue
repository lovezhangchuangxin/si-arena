<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "neutral" | "outline" | "accent" | "solid" | "warning" | "danger" | undefined;
    mono?: boolean | undefined;
  }>(),
  { tone: "neutral" },
);

const tones = {
  neutral: "bg-line text-ink",
  outline: "border border-line-strong text-soft",
  accent: "bg-accent-soft text-accent",
  solid: "bg-accent text-on-accent",
  warning: "bg-warning-soft text-warning",
  danger: "border border-danger-line bg-danger-soft text-danger-ink",
} as const;
</script>

<template>
  <span
    class="app-badge inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-0.5 text-xs leading-4 font-bold whitespace-nowrap"
    :class="[tones[tone], mono ? 'font-mono font-normal' : '']"
  >
    <slot />
  </span>
</template>
