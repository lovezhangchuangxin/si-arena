<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import type { useArena } from "../composables/useArena";
import { gameMatchLocation } from "../games/locations";
import { shortTime } from "../utils/time";
import MatchList from "./MatchList.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const props = defineProps<{ game: GameCatalogEntry; arena: ReturnType<typeof useArena> }>();
const status = props.arena.status;
const data = status.data;
const active = computed(() => data.value?.active);
</script>

<template>
  <div class="space-y-6">
    <StateBlock v-if="status.status.value === 'loading'" status="loading" />
    <StateBlock
      v-else-if="status.status.value === 'error'"
      status="error"
      :message="status.error.value"
      @retry="status.reload"
    />
    <template v-else-if="data">
      <section class="space-y-3" aria-live="polite">
        <div class="flex items-center gap-2.5">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="active ? 'bg-warning' : 'bg-accent'"
            aria-hidden="true"
          />
          <h2 class="text-lg font-bold">
            {{ active ? (active.status === "pending" ? "等待开局" : "正在运行") : "竞技场空闲" }}
          </h2>
          <span class="ml-auto text-xs text-faint">最多 {{ game.arena?.seats }} 人</span>
        </div>
        <p class="text-sm leading-7 text-soft">
          {{
            active
              ? `${active.participants.map((player) => player.username).join("、")} 已入场。本局结束后可开启下一局。`
              : "上传策略后，点击底部「开一局」参赛。你将与榜单选手同场竞技，人数不足时官方 bot 补一个席位。"
          }}
        </p>
        <AppButton v-if="active" :to="gameMatchLocation(game.id, active.id)"
          >查看正在进行的比赛</AppButton
        >
        <p v-else-if="data.lineup.length < 2" class="text-sm text-warning">
          入场选手少于 2 人，上传策略后刷新阵容。
        </p>
      </section>
      <section aria-labelledby="lineup-title" class="space-y-3">
        <h2 id="lineup-title" class="text-base font-bold">下一局阵容</h2>
        <p class="text-xs leading-6 text-faint">当前榜单预览；开局者必入场，其余席位按榜单选取。</p>
        <StateBlock
          v-if="!data.lineup.length"
          status="empty"
          message="还没有选手上传这个游戏的代码。"
        />
        <ol v-else class="space-y-2">
          <li
            v-for="(entry, seat) in data.lineup"
            :key="entry.userId"
            class="tile flex min-w-0 items-center gap-3 px-3 py-3"
          >
            <span
              class="grid size-8 shrink-0 place-items-center rounded-control font-display font-bold"
              :style="{ color: `var(--color-player-${seat})` }"
              >{{ seat + 1 }}</span
            >
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="truncate text-sm font-medium"
                >{{ entry.username }}
                <span v-if="entry.official" class="text-xs text-faint">官方补位</span></span
              >
              <span class="text-xs text-faint"
                >{{ entry.wins }} 冠 · 更新于 {{ shortTime(entry.codeUpdatedAt) }}</span
              >
            </span>
            <span class="text-right"
              ><span class="figure text-base">{{ entry.rating.toFixed(2) }}</span
              ><span class="block text-xs text-faint">排位分</span></span
            >
          </li>
        </ol>
      </section>
      <section aria-labelledby="arena-recent-title" class="space-y-3">
        <h2 id="arena-recent-title" class="text-base font-bold">最近比赛</h2>
        <p class="text-xs text-faint">
          全服共享 · 保留最近 {{ game.arena?.keepMatches }} 场，点击后在左侧查看
        </p>
        <MatchList v-if="data.recent.length" :matches="data.recent" />
        <StateBlock v-else status="empty" message="还没有结束的比赛。上传策略后开一局。" />
      </section>
    </template>
    <p v-if="status.refreshError.value" role="alert" class="text-sm text-danger-ink">
      {{ status.refreshError.value }}
      <AppButton size="sm" @click="status.reload">刷新竞技场</AppButton>
    </p>
  </div>
</template>
