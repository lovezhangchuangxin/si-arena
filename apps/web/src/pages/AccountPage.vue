<script setup lang="ts">
import { validatePassword } from "@si-arena/protocol";
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { errorMessage } from "../api/client";
import { changePassword, session, signOut } from "../auth/session";
import { useCatalog } from "../games/catalog";
import { useToast } from "../composables/useToast";
import AccountGameStats from "../components/AccountGameStats.vue";
import AccountGate from "../components/AccountGate.vue";
import AppButton from "../components/ui/AppButton.vue";
import AppField from "../components/ui/AppField.vue";

const oldPassword = ref("");
const newPassword = ref("");
const passwordError = ref("");
const pending = ref(false);
const leaving = ref(false);
const router = useRouter();
const toast = useToast();
const catalog = useCatalog();
const initial = computed(() => [...(session.user?.username ?? "")][0]?.toUpperCase() ?? "");
let current: AbortController | undefined;

watch(
  () => session.user?.id,
  () => {
    oldPassword.value = "";
    newPassword.value = "";
    passwordError.value = "";
  },
);
async function submit() {
  if (pending.value) return;
  passwordError.value = validatePassword(newPassword.value) ?? "";
  if (passwordError.value) return;
  const request = new AbortController();
  current = request;
  pending.value = true;
  const owner = session.user?.id;
  try {
    const changed = await changePassword(oldPassword.value, newPassword.value, request.signal);
    oldPassword.value = "";
    newPassword.value = "";
    if (changed && !request.signal.aborted) await router.replace("/login?changed=1");
  } catch (failure) {
    if (!request.signal.aborted && owner === session.user?.id) toast.error(errorMessage(failure));
  } finally {
    pending.value = false;
  }
}
async function logout() {
  if (leaving.value) return;
  leaving.value = true;
  try {
    await signOut();
    toast.success("已退出登录");
  } catch (failure) {
    toast.error(errorMessage(failure));
  } finally {
    leaving.value = false;
  }
}
onUnmounted(() => current?.abort());
</script>

<template>
  <div class="mx-auto max-w-[60rem]">
    <h1 v-if="!session.user" class="mb-6 text-2xl font-black">账号设置</h1>
    <AccountGate>
      <div class="flex flex-wrap items-start gap-6">
        <section class="card flex min-w-0 flex-[1_1_17.5rem] flex-col gap-4 p-6">
          <span
            class="user-avatar grid size-16 place-items-center rounded-card bg-player-0 font-display text-[30px] font-bold text-on-accent"
            aria-hidden="true"
            >{{ initial }}</span
          >
          <div class="flex flex-col gap-1">
            <h1 class="text-2xl font-black">账号设置</h1>
            <p class="font-mono text-sm break-all text-soft">{{ session.user?.username }}</p>
          </div>
          <dl class="grid grid-cols-2 gap-2.5">
            <AccountGameStats
              v-for="game in catalog.data.value?.games ?? []"
              :key="game.id"
              :game="game"
            />
          </dl>
          <AppButton :loading="leaving" @click="logout">退出登录</AppButton>
        </section>
        <section class="card flex min-w-0 flex-[999_1_26rem] flex-col gap-5 p-6 sm:p-7">
          <h2 class="text-xl font-bold">修改密码</h2>
          <form class="flex max-w-[26rem] flex-col gap-[1.125rem]" @submit.prevent="submit">
            <input
              class="sr-only"
              :value="session.user?.username"
              name="username"
              autocomplete="username"
              tabindex="-1"
              readonly
              aria-label="用户名"
            />
            <AppField label="当前密码" for-id="current-password">
              <input
                id="current-password"
                v-model="oldPassword"
                class="input min-h-12"
                type="password"
                autocomplete="current-password"
                required
                :disabled="pending"
              />
            </AppField>
            <AppField
              v-slot="{ describedBy }"
              label="新密码"
              for-id="new-password"
              :error="passwordError"
              hint="6–24 个字符"
            >
              <input
                id="new-password"
                v-model="newPassword"
                class="input min-h-12"
                type="password"
                autocomplete="new-password"
                :aria-describedby="describedBy"
                required
                :disabled="pending"
              />
            </AppField>
            <p
              class="rounded-control border border-warning/30 bg-warning/8 px-3.5 py-3 text-[13px] leading-6 text-warning"
            >
              修改成功后，所有设备都需要重新登录。
            </p>
            <AppButton
              variant="primary"
              size="lg"
              type="submit"
              class="self-start"
              :loading="pending"
            >
              修改密码
            </AppButton>
          </form>
        </section>
      </div>
    </AccountGate>
  </div>
</template>
