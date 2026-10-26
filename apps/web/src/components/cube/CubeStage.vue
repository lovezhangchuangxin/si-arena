<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { CubeScene, CubeSceneCubie } from "@si-arena/game-cube/renderer";

/**
 * Renders the cube game's data scene with CSS 3D: a perspective stage, a
 * preserve-3d cube of 26 six-sided blocks, and the in-flight layer spin.
 * Everything lives on a fixed 1060×680 design canvas (100px per cell scene
 * scale) that is scaled and centred to fit the layout box, so the
 * perspective and the panel stay identical at every size.
 */
const props = defineProps<{
  scene: CubeScene;
  aspectRatio: number;
  label: string;
  describedBy?: string;
}>();

const DESIGN_WIDTH = 1060;
const DESIGN_HEIGHT = 680;
/** Block edge length and gap between blocks, in design pixels. */
const SIZE = 116;
const GAP = 10;
const STEP = SIZE + GAP;

/** Per world face (facelet order U R F D L B): the element face transform. */
const FACE_TRANSFORM = [
  `rotateX(90deg) translateZ(${SIZE / 2}px)`, // U
  `rotateY(90deg) translateZ(${SIZE / 2}px)`, // R
  `translateZ(${SIZE / 2}px)`, // F
  `rotateX(-90deg) translateZ(${SIZE / 2}px)`, // D
  `rotateY(-90deg) translateZ(${SIZE / 2}px)`, // L
  `rotateY(180deg) translateZ(${SIZE / 2}px)`, // B
];

/** CSS rotation about the scene spin axis while the turn is in flight. */
const spinTransform = computed(() => {
  const spin = props.scene.spin;
  if (!spin || spin.angle === 0) return "";
  return `rotate${spin.axis}(${spin.angle}deg)`;
});

function cubieTransform(cubie: CubeSceneCubie): string {
  const [x, y, z] = cubie.pos;
  // The cubie box centres on the cube centre, so the spin rotates the whole
  // slab about the cube axis, not about the block itself.
  const spin = cubie.layer ? `${spinTransform.value} ` : "";
  return `${spin}translate3d(${x * STEP}px, ${y * STEP}px, ${z * STEP}px)`;
}

const host = ref<HTMLElement | null>(null);
const scale = ref(0.4);
let observer: ResizeObserver | undefined;

function fit() {
  const element = host.value;
  if (!element) return;
  const width = element.clientWidth;
  const height = element.clientHeight || (width / props.aspectRatio) | 0;
  const next = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  if (next > 0) scale.value = next;
}

onMounted(() => {
  fit();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(fit);
    observer.observe(host.value!);
  }
  window.addEventListener("resize", fit);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", fit);
});
</script>

<template>
  <div
    ref="host"
    class="cube-stage relative w-full overflow-hidden"
    :style="{ aspectRatio: `${props.aspectRatio}` }"
    role="img"
    :aria-label="props.label"
    :aria-describedby="props.describedBy"
  >
    <!-- Fixed design canvas, scaled and centred; the perspective lives inside. -->
    <div
      class="cube-stage__design absolute"
      :style="{
        width: `${DESIGN_WIDTH}px`,
        height: `${DESIGN_HEIGHT}px`,
        transform: `translate(-50%, -50%) scale(${scale})`,
      }"
      aria-hidden="true"
    >
      <div class="cube-stage__shadow"></div>
      <div class="cube-stage__perspective">
        <div class="cube-stage__cube" :style="{ transform: scene.view }">
          <div
            v-for="(cubie, index) in scene.cubies"
            :key="index"
            class="cube-stage__cubie"
            :style="{ transform: cubieTransform(cubie) }"
          >
            <template v-for="(colour, face) in cubie.colours" :key="face">
              <!-- Every block face renders: bare plastic closes the box, stickers sit on top. -->
              <div class="cube-stage__face" :style="{ transform: FACE_TRANSFORM[face] }">
                <div
                  v-if="colour"
                  class="cube-stage__plate"
                  :style="{ backgroundColor: colour }"
                ></div>
              </div>
            </template>
          </div>
        </div>
      </div>
      <p v-if="scene.panel.solved" class="cube-stage__solved">已还原</p>
      <aside class="cube-stage__panel">
        <p
          v-for="row in [
            ['MOVES', String(scene.panel.moves)],
            ['SCORE', String(scene.panel.score)],
            ['TICK', `${scene.panel.tick}/${scene.panel.maxTicks}`],
            ['LAST', scene.panel.last],
          ]"
          :key="row[0]"
          class="cube-stage__row"
        >
          <span class="cube-stage__label">{{ row[0] }}</span>
          <span class="cube-stage__figure">{{ row[1] }}</span>
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.cube-stage {
  background: var(--color-board);
  border-radius: var(--radius-panel);
}

.cube-stage__design {
  left: 50%;
  top: 50%;
  transform-origin: center;
}

.cube-stage__shadow {
  position: absolute;
  left: 130px;
  top: 555px;
  width: 440px;
  height: 60px;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.45);
  filter: blur(12px);
}

.cube-stage__perspective {
  position: absolute;
  left: 40px;
  top: 40px;
  width: 620px;
  height: 620px;
  perspective: 1500px;
  perspective-origin: 50% 36%;
}

.cube-stage__cube {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}

.cube-stage__cubie {
  position: absolute;
  /* Centre the 116px box on the cube centre so slab spins rotate about it. */
  left: -58px;
  top: -58px;
  width: 116px;
  height: 116px;
  transform-style: preserve-3d;
}

.cube-stage__face {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  /* Bare plastic: every face renders so the box reads as solid. */
  background: #0d0d11;
}

.cube-stage__plate {
  position: absolute;
  inset: 6px;
  border-radius: 10px;
  /* Raised sticker: a light-to-dark sweep plus a top highlight edge. */
  background-image: linear-gradient(135deg, rgb(255 255 255 / 0.22), rgb(0 0 0 / 0.18) 70%);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 0.4),
    inset 0 -2px 3px rgb(0 0 0 / 0.3);
}

.cube-stage__solved {
  position: absolute;
  left: 40px;
  top: 2px;
  width: 620px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--color-accent);
}

.cube-stage__panel {
  position: absolute;
  left: 730px;
  top: 90px;
  display: grid;
  gap: 34px;
  width: 300px;
  font-family: var(--font-mono);
}

.cube-stage__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-line);
  padding-bottom: 10px;
}

.cube-stage__label {
  font-size: 16px;
  letter-spacing: 0.14em;
  color: var(--color-soft);
}

.cube-stage__figure {
  font-size: 32px;
  font-weight: 600;
  color: var(--color-ink);
}
</style>
