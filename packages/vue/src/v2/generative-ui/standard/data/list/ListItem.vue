<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties, VNode } from "vue";
import type { z } from "zod";
import type { listItemSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../../standard-styles";
import type { GenerativeUIEventProp } from "../../context";
import ListItemBody from "./ListItemBody.vue";
import { isNativeMarker, useListContext } from "./list-context";

defineOptions({ name: "CopilotGenerativeUIListItem" });

type ListItemProps = z.output<typeof listItemSchema>;

/**
 * An item of a List: an `<li>` in a List, else a `<div>`. It shows a label,
 * a value on the right, a description, a marker or an icon, then its
 * children. With `action`, the user can pick it. A disabled item is
 * greyed out and ignores its action.
 */
const props = defineProps<{
  label?: ListItemProps["label"];
  value?: ListItemProps["value"];
  description?: ListItemProps["description"];
  icon?: ListItemProps["icon"];
  /** Shows this text as the marker, in place of the bullet or number. */
  marker?: ListItemProps["marker"];
  markerSize?: ListItemProps["markerSize"];
  disabled?: ListItemProps["disabled"];
  /** Runs when the user picks the item. */
  action?: GenerativeUIEventProp;
}>();

defineSlots<{
  /** Components shown below the description. */
  children?: () => VNode[];
}>();

useStandardStyles();
const listContext = useListContext();
/** The context of the List around the item, or `null` outside a List. */
const list = computed(() => listContext?.value ?? null);

const isDisabled = computed(() => props.disabled === true);
const pick = computed(() => {
  const action = isDisabled.value ? undefined : props.action;
  return action ? () => void action({}) : undefined;
});
const style = computed<CSSProperties>(() => {
  // An own marker replaces the native bullet or number.
  const hidesNativeMarker =
    props.marker !== undefined && isNativeMarker(list.value?.marker);
  return {
    listStyleType: hidesNativeMarker ? "none" : undefined,
    opacity: isDisabled.value ? 0.5 : undefined,
  };
});
</script>

<template>
  <component
    :is="list ? 'li' : 'div'"
    :aria-disabled="isDisabled || undefined"
    :style="style"
  >
    <ListItemBody
      :label="props.label"
      :value="pick ? undefined : props.value"
      :description="props.description"
      :icon="props.icon"
      :marker="props.marker"
      :marker-size="props.markerSize ?? list?.maxMarkerSize"
      :has-connector="list?.hasConnector"
      :on-pick="pick"
    >
      <slot name="children" />
    </ListItemBody>
  </component>
</template>
