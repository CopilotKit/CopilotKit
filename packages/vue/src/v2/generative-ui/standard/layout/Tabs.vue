<script lang="ts">
/** The next id of a Tabs, so the ids of two Tabs never collide. */
let nextTabsId = 0;
</script>

<script setup lang="ts">
import { computed } from "vue";
import type { VNode } from "vue";
import {
  borderColor,
  defined,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { StyleMap, tabsSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUITabs" });

type TabsProps = z.output<typeof tabsSchema>;

/**
 * Tabs with one panel per tab: the `child` of each entry, rendered by the
 * engine. The tab list is one tab stop: the arrow keys, Home and End move
 * between the tabs and open them. `selectedIndex` is a `v-model`.
 */
const props = defineProps<{
  /** The engine renders the `child` ref of each tab into a VNode. */
  tabs?: { title: string; child?: VNode }[];
  weight?: TabsProps["weight"];
}>();

const selectedIndex = defineModel<TabsProps["selectedIndex"]>("selectedIndex");

useStandardStyles();
const id = `a2ui-tabs-${nextTabsId++}`;
const tabs = computed(() => props.tabs ?? []);
const count = computed(() => tabs.value.length);
const selected = computed(() =>
  Math.min(Math.max(0, selectedIndex.value ?? 0), Math.max(0, count.value - 1)),
);

const rootStyle = computed(() =>
  defined({
    display: "flex",
    flexDirection: "column",
    gap: spacing(3),
    width: "100%",
    minWidth: 0,
    flexGrow: props.weight,
  }),
);
const LIST_STYLE: StyleMap = {
  display: "flex",
  gap: spacing(1),
  borderBottom: `1px solid ${borderColor("default")}`,
  overflowX: "auto",
};
const PANEL_STYLE: StyleMap = {
  display: "flex",
  flexDirection: "column",
  gap: spacing(3),
};

function tabStyle(isSelected: boolean): StyleMap {
  return {
    flexShrink: 0,
    padding: `${spacing(2)} ${spacing(3)}`,
    marginBottom: "-1px",
    border: "none",
    borderBottom: `2px solid ${isSelected ? textColor("default") : "transparent"}`,
    background: "transparent",
    color: isSelected ? textColor("default") : textColor("secondary"),
    font: "inherit",
    fontWeight: 500,
    cursor: "pointer",
  };
}

const tabButtons: Array<HTMLButtonElement | undefined> = [];

function setTabButton(index: number, element: unknown) {
  tabButtons[index] =
    element instanceof HTMLButtonElement ? element : undefined;
}

function select(index: number, focus = false) {
  selectedIndex.value = index;
  if (focus) tabButtons[index]?.focus();
}

/** The tab a key moves to, or `undefined` for any other key. */
function targetOf(key: string) {
  const total = count.value;
  switch (key) {
    case "ArrowRight":
      return (selected.value + 1) % total;
    case "ArrowLeft":
      return (selected.value - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return undefined;
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (count.value === 0) return;
  const next = targetOf(event.key);
  if (next === undefined) return;
  event.preventDefault();
  select(next, true);
}
</script>

<template>
  <div v-if="count > 0" data-a2ui-std="" data-a2ui-tabs="" :style="rootStyle">
    <div role="tablist" :style="LIST_STYLE" @keydown="onKeyDown">
      <button
        v-for="(tab, index) in tabs"
        :id="`${id}-tab-${index}`"
        :key="`${tab.title}-${index}`"
        :ref="(element) => setTabButton(index, element)"
        type="button"
        role="tab"
        :aria-selected="index === selected"
        :aria-controls="`${id}-panel-${index}`"
        :tabindex="index === selected ? 0 : -1"
        data-a2ui-input=""
        :style="tabStyle(index === selected)"
        @click="select(index)"
      >
        {{ tab.title }}
      </button>
    </div>
    <template v-for="(tab, index) in tabs" :key="index">
      <div
        v-if="index === selected"
        :id="`${id}-panel-${index}`"
        role="tabpanel"
        :aria-labelledby="`${id}-tab-${index}`"
        :style="PANEL_STYLE"
      >
        <component :is="tab.child" v-if="tab.child" />
      </div>
    </template>
  </div>
</template>
