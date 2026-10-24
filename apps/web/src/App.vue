<script setup lang="ts">
import { RouterView, useRoute } from "vue-router";
import { computed, onMounted, onUnmounted } from "vue";
import { restoreSession, session, syncSession } from "./auth/session";
import { provideCatalog } from "./games/catalog";
import AppHeader from "./components/AppHeader.vue";
import ToastHost from "./components/ui/ToastHost.vue";
import AppButton from "./components/ui/AppButton.vue";

const route = useRoute();
const gameWorkspace = computed(() => route.meta.workspace === true);
/** Sign-in pages bring their own brand panel instead of the site header. */
const bare = computed(() => route.meta.bare === true);
provideCatalog();

onMounted(() => {
  void restoreSession();
  window.addEventListener("storage", syncSession);
});
onUnmounted(() => window.removeEventListener("storage", syncSession));
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div
    class="app-shell flex min-h-dvh w-full flex-col"
    :class="{
      'app-shell--game': gameWorkspace,
      'app-shell--lobby': route.path === '/',
      'grid-backdrop': route.meta.backdrop === true,
    }"
  >
    <AppHeader v-if="!bare" :wide="gameWorkspace" />
    <div
      v-if="session.error"
      role="alert"
      class="shrink-0 border-b border-danger-line bg-danger-soft"
    >
      <div class="workspace flex flex-wrap items-center justify-between gap-3 py-2.5">
        <p class="text-sm text-danger-ink">{{ session.error }}</p>
        <AppButton size="sm" @click="restoreSession">恢复登录</AppButton>
      </div>
    </div>
    <main
      id="main-content"
      class="flex-1"
      :class="bare ? 'flex' : 'workspace py-6 sm:py-8'"
      tabindex="-1"
    >
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
  <ToastHost />
</template>
