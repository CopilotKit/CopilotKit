<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { spacing, textColor } from "@copilotkit/shared/generative-ui";
import type { audioPlayerSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIAudioPlayer" });

type AudioPlayerProps = z.output<typeof audioPlayerSchema>;

/**
 * An audio player for an audio file URL, with the description above it.
 * The description also names the player for screen readers.
 */
const props = defineProps<{
  url: AudioPlayerProps["url"];
  /** A title or summary of the audio, shown above the player. */
  description?: AudioPlayerProps["description"];
  weight?: AudioPlayerProps["weight"];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();

const CAPTION_STYLE: CSSProperties = {
  fontSize: ".875em",
  color: textColor("secondary"),
};
const PLAYER_STYLE: CSSProperties = { display: "block", width: "100%" };
const style = computed<CSSProperties>(() => ({
  display: "flex",
  flexDirection: "column",
  gap: spacing(1),
  margin: 0,
  width: "100%",
  minWidth: 0,
  flexGrow: props.weight,
}));
</script>

<template>
  <figure data-a2ui-std="" v-bind="aria" :style="style">
    <figcaption v-if="description" :style="CAPTION_STYLE">
      {{ description }}
    </figcaption>
    <audio
      controls
      preload="metadata"
      :src="url"
      :aria-label="description"
      :style="PLAYER_STYLE"
    />
  </figure>
</template>
