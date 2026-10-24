<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: readonly SelectOption[];
    id?: string | undefined;
    /** 无可见标签时用作无障碍名称。 */
    label?: string | undefined;
    placeholder?: string | undefined;
    size?: "sm" | "md" | undefined;
    disabled?: boolean | undefined;
  }>(),
  { size: "md" },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const listbox = ref<HTMLElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
/** 下方空间不足时向上弹出，避免弹层溢出视口。 */
const dropUp = ref(false);

const uid = useId();
const listboxId = `${uid}-listbox`;
const optionId = (index: number) => `${uid}-option-${index}`;
const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
/** 弹层持有 DOM 焦点时，当前高亮项要靠 aria-activedescendant 暴露给辅助技术。 */
const activeOptionId = computed(() =>
  activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined,
);

/** 弹层的最大高度与单个选项的高度，用来估算需要的空间。 */
const LIST_MAX_HEIGHT = 240;
const OPTION_HEIGHT = 32;

function reposition() {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  const needed = Math.min(props.options.length * OPTION_HEIGHT + 8, LIST_MAX_HEIGHT);
  // 下方够就往下弹；不够就往上弹，两侧都不够时选空间更大的一侧。
  dropUp.value = below < needed && (above >= needed || above > below);
}
function openList() {
  if (props.disabled) return;
  reposition();
  open.value = true;
  activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
  void nextTick(() => listbox.value?.focus());
}
function closeList(restoreFocus = true) {
  if (!open.value) return;
  open.value = false;
  if (restoreFocus) void nextTick(() => trigger.value?.focus());
}
function choose(option: SelectOption | undefined) {
  if (!option || option.disabled) return;
  emit("update:modelValue", option.value);
  closeList();
}
function scrollActiveIntoView() {
  void nextTick(() => {
    // scrollIntoView 在部分环境（如 jsdom）不存在
    listbox.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({
      block: "nearest",
    });
  });
}
/** 跳到指定位置，并沿 direction 方向跳过禁用项。 */
function moveTo(target: number, direction: 1 | -1) {
  const count = props.options.length;
  if (!count) return;
  let index = target;
  for (let step = 0; step < count; step++) {
    if (!props.options[index]?.disabled) break;
    index = (index + direction + count) % count;
  }
  activeIndex.value = index;
  scrollActiveIntoView();
}
/** 相对当前高亮项移动；还没有高亮项时按方向落到首项或末项。 */
function move(delta: number) {
  const count = props.options.length;
  if (!count) return;
  if (activeIndex.value === -1) {
    moveTo(delta > 0 ? 0 : count - 1, delta > 0 ? 1 : -1);
    return;
  }
  moveTo((activeIndex.value + delta + count) % count, delta > 0 ? 1 : -1);
}
function onTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
    event.preventDefault();
    // 弹层自己消费这些按键，不让外层的快捷键处理抢走。
    event.stopPropagation();
    openList();
  } else if (event.key === " " && !open.value) {
    event.preventDefault();
    event.stopPropagation();
    openList();
  }
}
function onListKeydown(event: KeyboardEvent) {
  // 弹层独占键盘：这些按键不再冒泡，避免触发外层（例如回放播放器）的快捷键。
  event.stopPropagation();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    moveTo(0, 1);
  } else if (event.key === "End") {
    event.preventDefault();
    moveTo(props.options.length - 1, -1);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    choose(props.options[activeIndex.value]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeList();
  } else if (event.key === "Tab") {
    closeList(false);
  }
}
function onPointerDown(event: PointerEvent) {
  if (!open.value) return;
  if (root.value && !root.value.contains(event.target as Node)) closeList(false);
}
function onViewportChange() {
  if (open.value) reposition();
}
watch(
  () => props.modelValue,
  () => {
    if (!open.value) return;
    activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
  },
);
onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
});
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <button
      ref="trigger"
      type="button"
      role="combobox"
      :id="id"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-controls="open ? listboxId : undefined"
      :disabled="disabled"
      class="app-select-trigger flex w-full min-w-0 items-center gap-2 border border-line-strong bg-subtle text-left text-ink transition hover:border-faint focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
      :class="
        size === 'sm'
          ? 'min-h-10 rounded-[0.5rem] px-2.5 text-[13px]'
          : 'min-h-11 rounded-control px-3 text-sm'
      "
      @click="open ? closeList() : openList()"
      @keydown="onTriggerKeydown"
    >
      <span class="min-w-0 flex-1 truncate">{{ selected?.label ?? placeholder ?? "请选择" }}</span>
      <svg
        class="size-3.5 shrink-0 text-faint transition"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 6.5L8 10.5L12 6.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <Transition name="select">
      <ul
        v-if="open"
        :id="listboxId"
        ref="listbox"
        role="listbox"
        :aria-label="label"
        :aria-activedescendant="activeOptionId"
        tabindex="-1"
        class="app-select-menu absolute left-0 z-50 max-h-60 w-full min-w-32 overflow-auto rounded-panel border border-line-strong bg-subtle p-1 shadow-pop focus:outline-none"
        :class="dropUp ? 'bottom-full mb-1' : 'top-full mt-1'"
        @keydown="onListKeydown"
      >
        <li
          v-for="(option, index) in options"
          :id="optionId(index)"
          :key="option.value"
          role="option"
          :data-value="option.value"
          :data-active="index === activeIndex ? 'true' : 'false'"
          :aria-selected="option.value === modelValue"
          :aria-disabled="option.disabled ? 'true' : undefined"
          class="flex cursor-pointer items-center justify-between gap-2 rounded-[0.5rem] px-2.5 py-1.5 text-sm transition"
          :class="[
            option.value === modelValue ? 'text-ink' : 'text-soft',
            index === activeIndex ? 'bg-line' : '',
            option.disabled ? 'cursor-not-allowed opacity-45' : '',
          ]"
          @click="choose(option)"
          @mouseenter="activeIndex = index"
        >
          <span class="min-w-0 truncate">{{ option.label }}</span>
          <svg
            v-if="option.value === modelValue"
            class="size-3.5 shrink-0 text-accent"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3.5 8.5L6.5 11.5L12.5 5"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.select-enter-active,
.select-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.select-enter-from,
.select-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
