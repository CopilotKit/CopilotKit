<script setup lang="ts">
import { computed, ref } from "vue";
import { formatFileSize, getSourceUrl } from "@copilotkit/shared";
import type { Attachment } from "@copilotkit/shared";
import { IconPause, IconPlay } from "../icons";

/**
 * Audio tile content for the attachment queue: a play/pause badge driving a
 * hidden `<audio>`, next to the filename and duration (or size).
 */
const props = defineProps<{
  attachment: Attachment;
}>();

const audioRef = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const duration = ref<number | null>(null);

const src = computed(() => getSourceUrl(props.attachment.source));
const meta = computed(() =>
  duration.value != null
    ? formatDuration(duration.value)
    : props.attachment.size != null
      ? formatFileSize(props.attachment.size)
      : null,
);

function togglePlayback() {
  const audio = audioRef.value;
  if (!audio) return;
  if (audio.paused) void audio.play();
  else audio.pause();
}

function handleLoadedMetadata(event: Event) {
  const seconds = (event.currentTarget as HTMLAudioElement).duration;
  if (Number.isFinite(seconds)) duration.value = seconds;
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
</script>

<template>
  <div class="cpk:flex cpk:items-center cpk:gap-2">
    <button
      type="button"
      class="cpk:flex cpk:size-8 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-lg cpk:border-none cpk:bg-primary/10 cpk:text-primary cpk:cursor-pointer cpk:transition-colors cpk:hover:bg-primary/15"
      :aria-label="playing ? 'Pause audio' : 'Play audio'"
      data-testid="copilot-chat-attachment-audio-toggle"
      @click="togglePlayback"
    >
      <IconPause
        v-if="playing"
        class="cpk:size-3.5 cpk:fill-current"
        aria-hidden="true"
      />
      <IconPlay
        v-else
        class="cpk:size-3.5 cpk:fill-current cpk:ml-px"
        aria-hidden="true"
      />
    </button>
    <div class="cpk:flex cpk:flex-col cpk:min-w-0">
      <span
        class="cpk:text-xs cpk:font-medium cpk:truncate cpk:leading-tight cpk:text-foreground"
        data-testid="copilot-chat-attachment-audio-filename"
      >
        {{ attachment.filename || "Audio" }}
      </span>
      <span
        v-if="meta"
        class="cpk:text-[11px] cpk:tabular-nums cpk:text-muted-foreground"
        data-testid="copilot-chat-attachment-audio-meta"
      >
        {{ meta }}
      </span>
    </div>
    <audio
      ref="audioRef"
      :src="src"
      preload="metadata"
      class="cpk:hidden"
      data-testid="copilot-chat-attachment-audio-element"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @loadedmetadata="handleLoadedMetadata"
    />
  </div>
</template>
