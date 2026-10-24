<script setup lang="ts">
import type { GameCatalogEntry, GameCodeInfo } from "@si-arena/protocol";
import { session } from "../auth/session";
import { shortTime } from "../utils/time";
import GameRulesPage from "./GameRulesPage.vue";

defineProps<{ game: GameCatalogEntry; code?: GameCodeInfo | null; entryReady?: boolean }>();
</script>

<template>
  <div class="space-y-6">
    <GameRulesPage :game="game" />
    <section aria-labelledby="my-code-title" class="min-w-0 border-t border-line pt-5">
      <details v-if="code" class="group">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 py-1">
          <span id="my-code-title" class="text-sm font-bold"
            >我的代码
            <span class="ml-1 text-xs font-normal text-faint"
              >{{ (code.sourceBytes / 1024).toFixed(1) }} KiB</span
            ></span
          >
          <svg
            class="size-4 shrink-0 text-faint transition group-open:rotate-180"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </summary>
        <p class="mt-3 text-xs text-faint">
          更新于 <time :datetime="code.updatedAt">{{ shortTime(code.updatedAt) }}</time> · 只读
        </p>
        <pre class="code-block mt-3 break-all whitespace-pre-wrap">{{ code.source }}</pre>
      </details>
      <template v-else>
        <h2 id="my-code-title" class="text-sm font-bold">我的代码</h2>
        <p class="mt-2 text-sm text-soft">
          {{
            !session.user
              ? "登录后查看或上传策略"
              : entryReady
                ? "尚未上传策略"
                : "正在读取当前策略…"
          }}
        </p>
      </template>
    </section>
  </div>
</template>
