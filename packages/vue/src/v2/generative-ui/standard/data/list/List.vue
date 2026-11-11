<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties, VNode } from "vue";
import type { z } from "zod";
import { ALIGN_CSS, spacing } from "@copilotkit/shared/generative-ui";
import type {
  ListItemValue,
  ListSelection,
  listSchema,
} from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../../standard-styles";
import type { GenerativeUIEventProp } from "../../context";
import ListItemBody from "./ListItemBody.vue";
import { isNativeMarker, provideListContext } from "./list-context";

defineOptions({ name: "CopilotGenerativeUIList" });

type ListProps = z.output<typeof listSchema>;

/**
 * A list of `items`, or of ListItem children: an `<ol>` for the "number"
 * marker, else a `<ul>`. An item with a value and no action is a key and
 * value row. With `action`, each item is a button, and a pick sends the
 * index, label and value of the item.
 */
const props = defineProps<{
  items?: ListProps["items"];
  direction?: ListProps["direction"];
  align?: ListProps["align"];
  weight?: ListProps["weight"];
  marker?: ListProps["marker"];
  connector?: ListProps["connector"];
  gap?: ListProps["gap"];
  /** The first number of the "number" marker. */
  start?: ListProps["start"];
  maxMarkerSize?: ListProps["maxMarkerSize"];
  /** Runs when the user picks an item. */
  action?: GenerativeUIEventProp<ListSelection>;
}>();

defineSlots<{
  /** ListItem children, shown when there are no `items`. */
  children?: () => VNode[];
}>();

useStandardStyles();

const marker = computed(() => props.marker ?? "bullet");
const hasConnector = computed(() => props.connector === "solid");
const isHorizontal = computed(() => props.direction === "horizontal");
const tag = computed(() => (marker.value === "number" ? "ol" : "ul"));

provideListContext(() => ({
  marker: marker.value,
  hasConnector: hasConnector.value,
  maxMarkerSize: props.maxMarkerSize,
}));

/** Safari drops the list role when list-style is "none". */
const role = computed(() =>
  isNativeMarker(marker.value) && !isHorizontal.value ? undefined : "list",
);

const style = computed<CSSProperties>(() => {
  const listStyleType =
    marker.value === "number"
      ? "decimal"
      : marker.value === "bullet"
        ? "disc"
        : "none";
  const horizontal = isHorizontal.value;
  return {
    margin: 0,
    paddingInlineStart:
      isNativeMarker(marker.value) && !horizontal ? "1.5em" : 0,
    listStyleType: horizontal ? "none" : listStyleType,
    display: "flex",
    flexDirection: horizontal ? "row" : "column",
    alignItems: props.align ? ALIGN_CSS[props.align] : undefined,
    flexGrow: props.weight,
    overflowX: horizontal ? "auto" : undefined,
    gap: spacing(props.gap ?? (horizontal ? 3 : 1)),
  };
});

function itemEntry(item: ListItemValue) {
  return typeof item === "string" ? { label: item } : item;
}

const entries = computed(() => {
  const action = props.action;
  const items = props.items ?? [];
  return items.map((item, index) => {
    const entry = itemEntry(item);
    const value = "value" in entry ? entry.value : undefined;
    return {
      key: `${entry.label}-${index}`,
      label: entry.label,
      // With an action, the value is the payload of the pick.
      shownValue: action ? undefined : value,
      description: "description" in entry ? entry.description : undefined,
      icon: "icon" in entry ? entry.icon : undefined,
      onPick: action
        ? () =>
            void action({
              index,
              label: entry.label,
              value: value === undefined ? undefined : String(value),
            })
        : undefined,
    };
  });
});
</script>

<template>
  <component
    :is="tag"
    class="a2ui-std-list"
    data-a2ui-std=""
    :role="role"
    :start="tag === 'ol' ? props.start : undefined"
    :style="style"
  >
    <template v-if="entries.length > 0">
      <li v-for="entry in entries" :key="entry.key">
        <ListItemBody
          :label="entry.label"
          :value="entry.shownValue"
          :description="entry.description"
          :icon="entry.icon"
          :marker-size="props.maxMarkerSize"
          :has-connector="hasConnector"
          :on-pick="entry.onPick"
        />
      </li>
    </template>
    <slot v-else name="children" />
  </component>
</template>
