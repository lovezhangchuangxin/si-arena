<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger" | "link" | undefined;
    size?: "sm" | "md" | "lg" | "icon" | undefined;
    to?: string | Record<string, unknown> | undefined;
    href?: string | undefined;
    /**
     * 仅下载型链接需要。类型含 Boolean 时 Vue 会把缺席属性转成 false，
     * 因此这里按值区分：true 表示无文件名下载，字符串表示指定文件名，
     * 缺席（false）表示普通导航链接。
     */
    download?: string | boolean | undefined;
    type?: "button" | "submit" | "reset" | undefined;
    disabled?: boolean | undefined;
    loading?: boolean | undefined;
    block?: boolean | undefined;
  }>(),
  { variant: "secondary", size: "md", type: "button" },
);

const variants = {
  primary: "bg-accent font-bold text-on-accent hover:bg-accent-strong",
  secondary: "border border-line-strong text-ink hover:border-faint hover:bg-subtle",
  ghost: "text-soft hover:bg-subtle hover:text-ink",
  danger: "border border-danger-line text-danger-ink hover:bg-danger-soft",
  link: "font-medium text-accent underline underline-offset-4 hover:text-accent-strong",
} as const;

// 盒模型与字号分开：Tailwind 同一层里的工具类按自身顺序决定优先级，
// 文字型按钮不能和尺寸类共用 px / min-h，否则会被尺寸类盖掉。
const sizes = {
  sm: { box: "min-h-9 rounded-[0.5rem] px-3", text: "text-[13px]" },
  md: { box: "min-h-11 rounded-control px-4", text: "text-sm" },
  lg: { box: "min-h-12 rounded-control px-5", text: "text-[15px]" },
  icon: { box: "size-11 shrink-0 rounded-control", text: "text-sm" },
} as const;

const inert = computed(() => props.disabled || props.loading);
const isLink = computed(() => Boolean(props.to || props.href));

const classes = computed(() => [
  "app-button",
  `app-button--${props.variant}`,
  "touch-target inline-flex items-center justify-center gap-2 whitespace-nowrap transition",
  props.variant === "link" ? "min-h-0 px-0" : sizes[props.size].box,
  props.variant === "primary" || props.variant === "link" ? "" : "font-medium",
  sizes[props.size].text,
  variants[props.variant],
  props.block ? "w-full" : "",
  inert.value ? "pointer-events-none opacity-45" : "",
]);

const element = computed(() => {
  // 链接没法真正 disabled：改用不可聚焦、不可导航的 span。
  if (inert.value && isLink.value) return "span";
  return props.to ? RouterLink : props.href ? "a" : "button";
});
const attributes = computed(() => {
  if (inert.value && isLink.value) {
    return {
      role: "link",
      "aria-disabled": "true",
      "aria-busy": props.loading || undefined,
      tabindex: "-1",
    };
  }
  if (props.to) return { to: props.to };
  if (props.href) {
    // 不带 download 属性的链接是普通导航（锚点跳转），不能被当成下载
    if (props.download === true) return { href: props.href, download: "" };
    if (typeof props.download === "string") return { href: props.href, download: props.download };
    return { href: props.href };
  }
  return {
    type: props.type,
    disabled: props.disabled || props.loading,
    "aria-busy": props.loading || undefined,
  };
});
</script>

<template>
  <component :is="element" v-bind="attributes" :class="classes">
    <span
      v-if="loading"
      class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </component>
</template>
