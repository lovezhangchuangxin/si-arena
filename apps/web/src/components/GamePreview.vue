<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import { gamePreviews } from "../games/previews";
import GameCanvas from "./GameCanvas.vue";

const props = withDefaults(defineProps<{ game: GameCatalogEntry; fit?: boolean }>(), {
  fit: true,
});
const preview = computed(() => {
  try {
    return { scene: gamePreviews.get(props.game.id)?.(props.game), error: "" };
  } catch {
    return { scene: undefined, error: "无法加载此游戏发行的初始画面。" };
  }
});
</script>

<template>
  <section class="game-preview" aria-label="游戏初始画面">
    <header
      class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1 font-mono text-[13px] text-soft"
    >
      <span>初始画面</span
      ><span
        >{{
          game.minPlayers === game.maxPlayers
            ? game.maxPlayers
            : `${game.minPlayers}–${game.maxPlayers}`
        }}
        人 · {{ game.maxTicks }} tick</span
      >
    </header>
    <GameCanvas
      v-if="preview.scene"
      :aspect-ratio="preview.scene.aspectRatio"
      :draw="preview.scene.draw"
      :label="`${game.name}静态初始画面`"
      :fit="fit"
    />
    <p v-else role="status" class="m-auto p-5 text-sm text-soft">
      {{ preview.error || "此游戏尚未提供初始画面。" }}
    </p>
  </section>
</template>
