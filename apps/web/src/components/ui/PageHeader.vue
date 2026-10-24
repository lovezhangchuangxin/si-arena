<script setup lang="ts">
defineProps<{
  title: string;
  description?: string | undefined;
}>();
</script>

<template>
  <header class="page-header flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
    <div class="flex min-w-0 flex-col gap-1.5">
      <h1 class="text-[28px] leading-tight font-black text-balance sm:text-[30px]">
        {{ title }}
      </h1>
      <p v-if="description" class="max-w-2xl text-[15px] leading-7 text-soft">
        {{ description }}
      </p>
      <slot />
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
