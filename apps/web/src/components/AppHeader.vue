<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { session } from "../auth/session";
import GameSwitcher from "./GameSwitcher.vue";
import AppLogo from "./AppLogo.vue";
import AppButton from "./ui/AppButton.vue";

defineProps<{ wide?: boolean }>();
const route = useRoute();
const open = ref(false);

const links = computed(() => [
  { to: "/", label: "大厅", active: route.path === "/" },
  { to: "/leaderboard", label: "排行榜", active: route.path === "/leaderboard" },
  { to: "/replays", label: "本地回放", active: route.path === "/replays" },
]);
const initial = computed(() => [...(session.user?.username ?? "")][0]?.toUpperCase() ?? "");

watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);
</script>

<template>
  <header
    class="sticky top-0 z-40 shrink-0 border-b border-line bg-background/90 backdrop-blur-md"
    @keydown.esc="open = false"
  >
    <div
      class="workspace flex min-h-14 items-center gap-x-2 sm:gap-x-5 lg:min-h-16"
      :class="{ 'max-w-[90rem]': wide }"
    >
      <RouterLink
        to="/"
        class="shrink-0 rounded-control text-ink max-sm:[&_span_span]:hidden"
        aria-label="SI Arena 首页"
        ><AppLogo
      /></RouterLink>
      <GameSwitcher />
      <nav
        id="site-menu"
        aria-label="主导航"
        class="absolute inset-x-0 top-full flex-col gap-1 border-b border-line bg-background p-3 lg:static lg:flex lg:flex-1 lg:flex-row lg:border-0 lg:bg-transparent lg:p-0"
        :class="open ? 'flex' : 'hidden'"
      >
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex min-h-11 items-center gap-1.5 rounded-[0.5rem] px-3.5 text-[15px] whitespace-nowrap transition"
          :class="link.active ? 'bg-subtle font-medium text-ink' : 'text-soft hover:text-ink'"
          :aria-current="link.active ? 'page' : undefined"
          >{{ link.label }}</RouterLink
        >
      </nav>
      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        <RouterLink
          v-if="session.user"
          to="/account"
          class="flex min-h-11 max-w-44 items-center gap-2.5 rounded-full border border-line py-1.5 pr-1.5 pl-1.5 text-sm text-ink transition hover:border-line-strong sm:pr-3.5"
          :aria-label="`账号：${session.user.username}`"
        >
          <span
            class="grid size-[30px] shrink-0 place-items-center rounded-full bg-player-0 font-bold text-on-accent"
            aria-hidden="true"
            >{{ initial }}</span
          >
          <span class="hidden truncate sm:inline">{{ session.user.username }}</span>
        </RouterLink>
        <AppButton v-else-if="session.ready" size="sm" to="/login">登录</AppButton>
        <button
          type="button"
          class="grid size-11 place-items-center rounded-control text-ink transition hover:bg-subtle lg:hidden"
          :aria-label="open ? '关闭菜单' : '打开菜单'"
          :aria-expanded="open"
          aria-controls="site-menu"
          @click="open = !open"
        >
          <svg
            class="size-[22px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path v-if="open" d="M6 6l12 12M18 6L6 18" />
            <path v-else d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>
