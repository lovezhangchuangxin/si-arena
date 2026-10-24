<script setup lang="ts">
import { computed } from "vue";
import type { GameCatalogEntry } from "@si-arena/protocol";
import { gamePreviews } from "../../games/previews";
import GameCanvas from "../GameCanvas.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const preview = computed(() => {
  try {
    return { scene: gamePreviews.get(props.game.id)?.(props.game, true), error: "" };
  } catch {
    return { scene: undefined, error: "展示画面暂时无法加载" };
  }
});
</script>

<template>
  <div class="lobby-live-cover">
    <GameCanvas
      v-if="preview.scene"
      :aspect-ratio="preview.scene.aspectRatio"
      :draw="preview.scene.draw"
      :label="`${game.name}静态游戏展示帧`"
      :fit="true"
    />
    <p v-else class="lobby-cover-error" role="status">
      {{ preview.error || "此发行暂无展示画面" }}
    </p>
  </div>
</template>
