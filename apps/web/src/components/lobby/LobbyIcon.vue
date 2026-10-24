<script setup lang="ts">
defineProps<{ name: string }>();
const paths: Record<string, string> = {
  grid: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z",
  duel: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM1 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 8M18 15a6 6 0 0 1 5 6",
  arena:
    "M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21v-3a6 6 0 0 1 12 0v3M3 7v5M0 21v-3a4 4 0 0 1 3-4M21 7v5M24 21v-3a4 4 0 0 0-3-4",
  chart: "M4 20V9M12 20V3M20 20v-7",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8z",
  replay: "M3 3h18v14H3zM8 22h8M12 17v5m-2-16 6 4-6 4z",
  search: "M21 21l-6-6M17 10A7 7 0 1 1 3 10a7 7 0 0 1 14 0Z",
  arrow: "M4 12h16m-6-6 6 6-6 6",
};
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.grid" />
  </svg>
</template>
