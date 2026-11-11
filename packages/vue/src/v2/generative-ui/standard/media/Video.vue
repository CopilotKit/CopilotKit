<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { hostOf, radius, spacing } from "@copilotkit/shared/generative-ui";
import type { videoSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import { videoSourceOf, youTubeIdOf } from "./video-source";

defineOptions({ name: "CopilotGenerativeUIVideo" });

type VideoProps = z.output<typeof videoSchema>;

/**
 * A video. A file plays in the native player, with its caption tracks. A
 * YouTube video shows its poster first, and the privacy-enhanced player
 * (youtube-nocookie.com) loads only when the user presses play. A page on
 * another video site, or a file that fails to load, shows as a link.
 *
 * The YouTube player is cross-origin, so `allow-same-origin` only lets it
 * use its own origin. It cannot get to the host page.
 */
const props = defineProps<{
  /** A video file URL, or a YouTube video or short. */
  url: VideoProps["url"];
  /** The image shown before the video plays. */
  posterUrl?: VideoProps["posterUrl"];
  /** Names the video for screen readers. */
  title?: VideoProps["title"];
  /** Caption tracks of a video file. */
  captions?: VideoProps["captions"];
  /** Default "16 / 9". */
  aspectRatio?: VideoProps["aspectRatio"];
  /** Default "100%". */
  width?: VideoProps["width"];
  /** Default "100%". */
  maxWidth?: VideoProps["maxWidth"];
  weight?: VideoProps["weight"];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const isPlaying = ref(false);
/** The url of a file that failed to load. */
const failedUrl = ref<string>();
// A new url starts on its poster, so a video played before does not autoplay.
watch(
  () => props.url,
  () => (isPlaying.value = false),
);

const youTubeId = computed(() => youTubeIdOf(props.url));
/**
 * What the Video shows. A file that does not load leaves a dead player, so
 * the link takes its place. A YouTube video shows its poster first: no
 * third-party script runs until the user asks to play.
 */
const view = computed(() => {
  const isLink =
    videoSourceOf(props.url) === "page" || failedUrl.value === props.url;
  if (isLink) return "link";
  if (youTubeId.value === undefined) return "file";
  return isPlaying.value ? "youtube" : "poster";
});

const host = computed(() => hostOf(props.url));
const href = computed(() => {
  const url = props.url.trim();
  return /^https?:/i.test(url) ? url : undefined;
});
/** The link card is an `<a>` for an http(s) URL, else a `<span>`. */
const linkAttributes = computed(() => {
  if (href.value === undefined) return aria.value;
  return {
    href: href.value,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": `Open ${props.title ?? "video"} on ${host.value ?? "its site"}`,
    ...aria.value,
  };
});

const box = computed<CSSProperties>(() => ({
  display: "block",
  aspectRatio: props.aspectRatio ?? "16 / 9",
  width: spacing(props.width) ?? "100%",
  maxWidth: spacing(props.maxWidth) ?? "100%",
  flexGrow: props.weight,
  borderRadius: radius("lg"),
}));
const linkStyle = computed<CSSProperties>(() => ({
  ...box.value,
  aspectRatio: undefined,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing(2),
  padding: spacing(6),
  boxSizing: "border-box",
  background: "#000",
  color: "#fff",
  textDecoration: "none",
}));
// Tracks load in the CORS mode of their media element. Without one, a
// caption file on another host never loads, so the player gets
// `crossorigin` when it has captions.
const playerStyle = computed<CSSProperties>(() => ({
  ...box.value,
  background: "#000",
  objectFit: "contain",
}));
const posterStyle = computed<CSSProperties>(() => ({
  ...box.value,
  position: "relative",
  padding: 0,
  border: "none",
  overflow: "hidden",
  cursor: "pointer",
  background: "#000",
}));
const frameStyle = computed<CSSProperties>(() => ({ ...box.value, border: 0 }));

const PLAY_CIRCLE_STYLE: CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "50%",
  background: "rgba(255,255,255,.15)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "16px",
};
const TITLE_STYLE: CSSProperties = { fontWeight: 500 };
const HOST_STYLE: CSSProperties = { opacity: 0.7, fontSize: ".875em" };
const POSTER_IMAGE_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};
const PLAY_BADGE_STYLE: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "56px",
  height: "40px",
  borderRadius: "12px",
  background: "rgba(0,0,0,.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontSize: "18px",
};
</script>

<template>
  <component
    :is="href === undefined ? 'span' : 'a'"
    v-if="view === 'link'"
    data-a2ui-video-link=""
    v-bind="linkAttributes"
    :style="linkStyle"
  >
    <span aria-hidden="true" :style="PLAY_CIRCLE_STYLE">▶</span>
    <span :style="TITLE_STYLE">{{ title ?? "Watch video" }}</span>
    <span v-if="host" :style="HOST_STYLE">{{ host }}</span>
  </component>
  <video
    v-else-if="view === 'file'"
    controls
    preload="metadata"
    :src="url"
    :poster="posterUrl"
    :title="title"
    :aria-label="title"
    v-bind="aria"
    :crossorigin="captions?.length ? 'anonymous' : undefined"
    :style="playerStyle"
    @error="failedUrl = url"
  >
    <track
      v-for="(track, index) in captions ?? []"
      :key="`${track.url}-${index}`"
      :src="track.url"
      :kind="track.kind ?? 'subtitles'"
      :srclang="track.language"
      :label="track.label"
      :default="index === 0 ? true : undefined"
    />
  </video>
  <button
    v-else-if="view === 'poster'"
    type="button"
    :aria-label="`Play ${title ?? 'video'}`"
    v-bind="aria"
    :style="posterStyle"
    @click="isPlaying = true"
  >
    <img
      :src="posterUrl ?? `https://i.ytimg.com/vi/${youTubeId}/hqdefault.jpg`"
      alt=""
      :style="POSTER_IMAGE_STYLE"
    />
    <span aria-hidden="true" :style="PLAY_BADGE_STYLE">▶</span>
  </button>
  <iframe
    v-else
    :src="`https://www.youtube-nocookie.com/embed/${youTubeId}?autoplay=1`"
    :title="title ?? 'YouTube video'"
    v-bind="aria"
    allow="
      accelerometer;
      autoplay;
      encrypted-media;
      gyroscope;
      picture-in-picture;
      fullscreen;
    "
    sandbox="allow-scripts allow-same-origin allow-presentation"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
    :style="frameStyle"
  />
</template>
