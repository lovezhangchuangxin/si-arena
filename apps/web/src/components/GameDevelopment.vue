<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import {
  devkitDownloadPath,
  parseGameDevelopment,
  parseGameReleaseMetadata,
} from "@si-arena/protocol";
import { computed, ref, watch } from "vue";
import { useApiResource } from "../composables/useApiResource";
import { useToast } from "../composables/useToast";
import { copyText } from "../utils/clipboard";
import AppBadge from "./ui/AppBadge.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const toast = useToast();
const promptOpen = ref(false);
const setupOpen = ref(false);
const base = computed(() => `/api/games/${encodeURIComponent(props.game.id)}`);
const { data, status, error, reload } = useApiResource(
  () => `${base.value}/development`,
  parseGameDevelopment,
);
const {
  data: release,
  status: releaseStatus,
  reload: reloadRelease,
} = useApiResource(
  () => `${base.value}/devkit`,
  (raw) => {
    const value = parseGameReleaseMetadata(raw);
    if (value.game.id !== props.game.id || value.game.release !== props.game.release)
      throw new Error("开发包与当前游戏发行不匹配");
    return value;
  },
);
const downloadPath = computed(() => devkitDownloadPath(props.game.id));
const command = computed(
  () =>
    `npx @si-arena/cli@latest init ${props.game.id} ./${props.game.id}-bot --server ${JSON.stringify(window.location.origin)}`,
);
const quickStart = computed(() =>
  [
    command.value,
    `cd ${props.game.id}-bot && pnpm install --frozen-lockfile`,
    "pnpm arena dev --bot ./bot.js",
    "pnpm arena run --bot ./bot.js --seed 42",
  ].join("\n"),
);
const steps = [
  { title: "初始化项目", text: "下载最新开发包并校验" },
  { title: "让 AI 写 bot.js", text: "把统一提示词交给你的 AI" },
  { title: "本地对战调试", text: "和官方 bot 开局、看回放" },
  { title: "上传并匹配", text: "在底部上传策略并主动参赛" },
];
const setupPrompt = computed(() => {
  const directory = `./${props.game.id}-bot`;
  return [
    `我要参加 SI Arena 平台的「${props.game.name}」编程竞技。请作为我的策略研究 Agent，在本地完成环境准备、机制研究、对照实验和迭代优化，交付预算内最强的可用 bot。跑通代码或战胜官方示例不是任务终点。`,
    ``,
    `1. 检查 node -v、pnpm -v：需要 Node.js ≥ 26 与 pnpm ≥ 12，缺失时按当前系统准备环境。初始化命令如下；若目录已有项目，先保留代码和研究记录，在已有项目中执行 pnpm arena update，再执行 pnpm install --frozen-lockfile，不重新初始化或删除非空目录：`,
    `   ${command.value}`,
    `2. 进入 ${directory}，执行 pnpm install --frozen-lockfile。阅读 PROMPT.md、SDK.md、release.json 和 bots/official.js；必要时核对包内规则实现。`,
    `3. 完整执行 PROMPT.md 的研究流程与预算规则（用户明确要求优先），不要把安装完成或战胜官方示例当作任务完成。已有成果先保存并作为基线，用 pnpm arena run --bot ./bot.js 开始本地验证，后续对照实验、历史最佳保留和独立验证均按 PROMPT.md 执行。`,
    `4. 交付最终 bot.js 与真实研究报告。研究记录留在本地，提醒我回到网页上传 bot.js，上传和线上开赛由我操作。`,
  ].join("\n");
});
async function copy(text: string, label: string, onFail?: () => void) {
  if (await copyText(text)) {
    toast.success(`${label}已复制。`);
    return;
  }
  onFail?.();
  toast.warning("无法访问剪贴板，请手动选择并复制下方文本。");
}
function sourceLink(source: string) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(source)}`;
}
// The route reuses this component across games; collapsed panels must not leak between them.
watch(
  () => props.game.id,
  () => {
    promptOpen.value = false;
    setupOpen.value = false;
  },
);
</script>

<template>
  <section
    id="development"
    class="flex scroll-mt-20 flex-col gap-4"
    aria-labelledby="development-title"
  >
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="development-title" class="text-xl font-bold">开发资料</h2>
      <AppBadge tone="outline" mono
        >{{ game.release }} · 接口 v{{ game.botProtocolVersion }}</AppBadge
      >
    </header>

    <section class="card flex flex-col gap-4 p-5" aria-labelledby="quick-start-title">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="quick-start-title" class="text-lg font-bold">快速开始</h3>
        <span class="text-[13px] text-faint">需要 Node.js 26+ 与 pnpm 12</span>
      </div>
      <ol class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
        <li
          v-for="(step, index) in steps"
          :key="step.title"
          class="tile flex flex-col gap-1.5 p-3.5"
        >
          <span class="figure text-accent">{{ String(index + 1).padStart(2, "0") }}</span>
          <span class="font-bold">{{ step.title }}</span>
          <span class="text-[13px] text-soft">{{ step.text }}</span>
        </li>
      </ol>
      <pre class="code-block text-accent"><code>{{ quickStart }}</code></pre>
      <div class="flex flex-wrap items-center gap-2.5">
        <AppButton variant="primary" @click="copy(command, '初始化命令')">复制初始化命令</AppButton>
        <AppButton @click="copy(setupPrompt, 'AI 安装提示词', () => (setupOpen = true))"
          >复制 AI 安装提示词</AppButton
        >
        <AppButton v-if="release" :href="downloadPath" download>下载开发包 ZIP</AppButton>
        <span v-if="release" class="font-mono text-xs text-faint"
          >{{ (release.archive.bytes / 1024 / 1024).toFixed(1) }} MiB</span
        >
      </div>
      <p class="text-sm leading-6 text-soft">
        已有项目更新：<code>pnpm arena update</code>，然后执行
        <code>pnpm install --frozen-lockfile</code>。保留玩家代码和研究记录。
      </p>
      <StateBlock v-if="releaseStatus === 'loading'" status="loading" />
      <div v-else-if="releaseStatus === 'error'" class="flex flex-wrap items-center gap-3">
        <p class="text-sm leading-6 text-soft">
          此发行的下载包暂不可用，初始化命令与提示词仍可使用。
        </p>
        <AppButton size="sm" @click="reloadRelease">重新获取开发包</AppButton>
      </div>
      <details
        class="border-t border-line pt-3"
        :open="setupOpen"
        @toggle="setupOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="w-fit cursor-pointer py-1 text-sm text-soft hover:text-ink">
          查看 AI 安装提示词全文（环境准备、初始化与编写 bot 一条龙）
        </summary>
        <textarea
          aria-label="AI 安装提示词"
          class="input mt-2 min-h-72 resize-y p-3.5 font-mono text-[13px] leading-6"
          readonly
          :value="setupPrompt"
        />
      </details>
    </section>

    <StateBlock v-if="status === 'loading'" status="loading" />
    <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
    <template v-else-if="data">
      <section class="card flex flex-col gap-3.5 p-5" aria-labelledby="prompt-title">
        <h3 id="prompt-title" class="text-lg font-bold">统一参赛提示词</h3>
        <p class="text-sm leading-7 text-soft">
          所有玩家拿到的是同一份提示词，包含规则、SDK、限额与编写要求。
        </p>
        <div class="flex flex-wrap gap-2.5">
          <AppButton @click="copy(data.prompt, '参赛提示词', () => (promptOpen = true))"
            >复制提示词</AppButton
          >
          <AppButton :href="sourceLink(data.prompt)" download="PROMPT.md">下载提示词</AppButton>
        </div>
        <details
          :open="promptOpen"
          @toggle="promptOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary class="w-fit cursor-pointer py-1 text-sm text-soft hover:text-ink">
            查看提示词全文
          </summary>
          <textarea
            aria-label="统一参赛提示词"
            class="input mt-2 min-h-64 resize-y p-3.5 font-mono text-[13px] leading-6"
            readonly
            :value="data.prompt"
          />
        </details>
      </section>
      <details class="card px-5 py-4">
        <summary class="cursor-pointer font-bold">SDK 与执行说明</summary>
        <AppButton class="mt-3" @click="copy(data.sdk, 'SDK 说明')">复制 SDK 说明</AppButton>
        <pre class="code-block mt-3 max-h-[32rem] break-words whitespace-pre-wrap">{{
          data.sdk
        }}</pre>
      </details>
      <details class="card px-5 py-4">
        <summary class="cursor-pointer font-bold">官方示例 bot</summary>
        <div class="mt-3 flex flex-wrap gap-2.5">
          <AppButton @click="copy(data.officialBot, '官方代码')">复制官方代码</AppButton>
          <AppButton :href="sourceLink(data.officialBot)" download="official.js"
            >下载 official.js</AppButton
          >
        </div>
        <pre class="code-block mt-3 max-h-96">{{ data.officialBot }}</pre>
      </details>
      <details class="card px-5 py-4">
        <summary class="cursor-pointer font-bold">最小代码模板</summary>
        <pre class="code-block mt-3 max-h-96 text-ink">{{ data.template }}</pre>
        <AppButton class="mt-3" :href="sourceLink(data.template)" download="bot.js"
          >下载 bot.js</AppButton
        >
      </details>
      <p class="tile p-3.5 text-[13px] leading-6 text-soft">
        限额：源码 {{ game.resolvedLimits.codeBytes / 1024 }} KiB · CPU
        {{ game.resolvedLimits.cpuMs }} ms / tick · 运行内存
        {{ game.resolvedLimits.heapBytes / 1024 / 1024 }} MiB · Memory
        {{ game.resolvedLimits.memoryBytes / 1024 }} KiB。超出时该 tick 用默认动作，保留上次成功的
        Memory。
      </p>
    </template>
  </section>
</template>
