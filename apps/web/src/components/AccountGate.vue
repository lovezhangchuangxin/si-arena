<script setup lang="ts">
import { useRoute } from "vue-router";
import { session, restoreSession } from "../auth/session";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const route = useRoute();
</script>

<template>
  <StateBlock v-if="!session.ready" status="loading" />
  <StateBlock
    v-else-if="session.error"
    status="error"
    :message="session.error"
    action-label="重新连接"
    @retry="restoreSession"
  />
  <div
    v-else-if="!session.user"
    class="account-gate flex flex-wrap items-center justify-between gap-3 p-4"
  >
    <p class="text-sm text-soft">尚未登录</p>
    <AppButton variant="primary" :to="{ path: '/login', query: { next: route.fullPath } }"
      >登录参赛</AppButton
    >
  </div>
  <slot v-else :key="session.user.id" />
</template>
