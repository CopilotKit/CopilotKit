<script setup lang="ts">
import { computed, inject } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  backgroundColor,
  borderColor,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  followUpArgs,
  followUpSchema,
} from "@copilotkit/shared/generative-ui";
import {
  GenerativeUINodeKey,
  useGenerativeUIRuntime,
} from "../../runtime-context";
import { useStandardStyles } from "../../standard-styles";
import type { GenerativeUIEventProp } from "../context";
import { PILL_BUTTON, SECONDARY_SM } from "./styles";

defineOptions({ name: "CopilotGenerativeUIFollowUp" });

type FollowUpProps = z.output<typeof followUpSchema>;

/** The event a FollowUp pill sends when the model bound no onFollowUp. */
const FOLLOW_UP_EVENT = "follow_up";

/**
 * Suggested next prompts as pills. A FollowUp always sends: when the model
 * bound `onFollowUp`, that binding runs. Else the pill forwards a
 * `follow_up` event with its message, which the engine turns into a visible
 * user message with that text. Without items it renders nothing.
 */
const props = defineProps<{
  /** The pills: a label, or a label with the message it sends. */
  items?: FollowUpProps["items"];
  /** A caption above the pills. */
  title?: FollowUpProps["title"];
  /** Sent when the user clicks a pill, with the message of the pill. */
  onFollowUp?: GenerativeUIEventProp<z.input<typeof followUpArgs>>;
}>();

useStandardStyles();
const runtime = useGenerativeUIRuntime();
const node = inject(GenerativeUINodeKey, null);

const entries = computed(() =>
  (props.items ?? []).map((item) => {
    const entry = typeof item === "string" ? { label: item } : item;
    return { label: entry.label, message: entry.message ?? entry.label };
  }),
);

function send(message: string) {
  if (props.onFollowUp) {
    void props.onFollowUp({ message });
    return;
  }
  const current = runtime.value;
  if (!current || !node) return;
  const { surfaceKey, surfaceId, componentId } = node.value;
  const surface = current.manager.getSurfaceByKey(surfaceKey);
  void current.forwardEvent(
    {
      name: FOLLOW_UP_EVENT,
      surfaceId,
      componentId,
      userMessage: message,
      context: { message },
    },
    surface?.agentId,
  );
}

const ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: spacing(2),
};
const PILLS_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: spacing(2),
};
const PILL_STYLE: CSSProperties = {
  ...PILL_BUTTON,
  border: `1px solid ${borderColor("default")}`,
  background: backgroundColor("surface"),
  color: textColor("default"),
};
</script>

<template>
  <div
    v-if="entries.length > 0"
    data-a2ui-follow-up=""
    data-a2ui-std=""
    :style="ROOT_STYLE"
  >
    <span v-if="title" :style="SECONDARY_SM">{{ title }}</span>
    <div :style="PILLS_STYLE">
      <button
        v-for="(entry, index) in entries"
        :key="`${entry.label}-${index}`"
        type="button"
        data-a2ui-input=""
        :style="PILL_STYLE"
        @click.stop="send(entry.message)"
      >
        {{ entry.label }}
      </button>
    </div>
  </div>
</template>
