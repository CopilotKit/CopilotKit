<script setup lang="ts">
import { computed, ref } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { flashcardSchema } from "@copilotkit/shared/generative-ui";
import { BUTTON_RESET, useFeedbackStyles } from "./styles";

defineOptions({ name: "CopilotGenerativeUIFlashcardFlip" });

type FlashcardProps = z.output<typeof flashcardSchema>;

/**
 * A card that shows the `front` text, and flips to the `back` text and
 * back again. It is a native toggle button: a click, Enter and Space flip
 * it, and `aria-pressed` tells a screen reader which side shows. The
 * `hint` shows under the front only.
 */
const props = defineProps<{
  front?: FlashcardProps["front"];
  back?: FlashcardProps["back"];
  hint?: FlashcardProps["hint"];
}>();

useFeedbackStyles();

const flipped = ref(false);
const showsHint = computed(() => props.hint !== undefined && !flipped.value);

const FACE_STYLE: CSSProperties = { ...textFont("lg"), fontWeight: 600 };
const HINT_STYLE: CSSProperties = {
  ...textFont("sm"),
  color: textColor("tertiary"),
};

const style = computed(
  (): CSSProperties => ({
    ...BUTTON_RESET,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    minHeight: "140px",
    width: "100%",
    padding: spacing(5),
    boxSizing: "border-box",
    textAlign: "center",
    border: `1px solid ${borderColor("default")}`,
    borderRadius: radius("xl"),
    background: backgroundColor(
      flipped.value ? "surface-secondary" : "surface",
    ),
    color: textColor("default"),
  }),
);
</script>

<template>
  <button
    type="button"
    :aria-pressed="flipped"
    data-a2ui-std=""
    data-a2ui-feedback-button=""
    :style="style"
    @click="flipped = !flipped"
  >
    <span :style="FACE_STYLE">{{ flipped ? back : front }}</span>
    <span v-if="showsHint" :style="HINT_STYLE">{{ hint }}</span>
  </button>
</template>
