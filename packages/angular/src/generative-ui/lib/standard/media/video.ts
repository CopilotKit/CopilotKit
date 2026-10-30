import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { DomSanitizer } from "@angular/platform-browser";
import { radius, spacing, textColor } from "@copilotkit/shared/generative-ui";
import type { videoSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import type { StyleMap } from "../style";
import { hostOf } from "../url";

/** A YouTube id is about 11 characters of [A-Za-z0-9_-]. Others are refused. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * The id of a YouTube video or short in `url`, or `undefined` for another
 * URL. Accepts watch, embed, shorts, live and youtu.be links.
 */
export function youTubeIdOf(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  let id: string | null | undefined;
  if (host === "youtu.be") {
    id = parsed.pathname.slice(1);
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const match = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
    id = match ? match[1] : parsed.searchParams.get("v");
  }
  return id && YOUTUBE_ID.test(id) ? id : undefined;
}

const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8|mpd)$/i;
/** Video sites whose pages the native player cannot play. */
const VIDEO_PAGE_HOSTS = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "dailymotion.com",
  "twitch.tv",
  "tiktok.com",
  "loom.com",
  "wistia.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
];

/**
 * How to show a video URL: the YouTube embed, the native player for a file
 * (a known extension, or any URL that is not a page of a video site), or a
 * link for a page the player cannot play. A URL that does not parse is a
 * file: the player reports the failure, and the link takes its place.
 */
export function videoSourceOf(url: string): "youtube" | "file" | "page" {
  if (youTubeIdOf(url) !== undefined) return "youtube";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "file";
  }
  if (VIDEO_FILE.test(parsed.pathname)) return "file";
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  const isPage = VIDEO_PAGE_HOSTS.some(
    (site) => host === site || host.endsWith(`.${site}`),
  );
  return isPage ? "page" : "file";
}

/**
 * A video player for a file, the YouTube embed behind its poster, or a link
 * for a page the player cannot play. The host is `display: contents`, so the
 * player, the poster button, the iframe or the link lays out as the root.
 * The YouTube player is cross-origin
 * (youtube-nocookie.com), so allow-same-origin only lets it use its own
 * origin; it cannot get to the host page.
 */
@Component({
  selector: "div[copilotGenerativeUIVideo]",
  template: `
    @switch (view()) {
      @case ("link") {
        @if (href(); as href) {
          <a
            data-a2ui-video-link
            [href]="href"
            target="_blank"
            rel="noopener noreferrer"
            [attr.aria-label]="
              'Open ' + (title() ?? 'video') + ' on ' + (host() ?? 'its site')
            "
            [attr.aria-description]="aria()['aria-description'] ?? null"
            [attr.aria-hidden]="aria()['aria-hidden'] ? 'true' : null"
            [attr.aria-live]="aria()['aria-live'] ?? null"
            [style]="linkStyle()"
          >
            <ng-container *ngTemplateOutlet="linkBody" />
          </a>
        } @else {
          <span
            data-a2ui-video-link
            [attr.aria-label]="aria()['aria-label'] ?? null"
            [attr.aria-description]="aria()['aria-description'] ?? null"
            [attr.aria-hidden]="aria()['aria-hidden'] ? 'true' : null"
            [attr.aria-live]="aria()['aria-live'] ?? null"
            [style]="linkStyle()"
          >
            <ng-container *ngTemplateOutlet="linkBody" />
          </span>
        }
      }
      @case ("file") {
        <video
          controls
          preload="metadata"
          [src]="url()"
          [attr.poster]="posterUrl() ?? null"
          [attr.title]="title() ?? null"
          [attr.aria-label]="aria()['aria-label'] ?? title() ?? null"
          [attr.aria-description]="aria()['aria-description'] ?? null"
          [attr.aria-hidden]="aria()['aria-hidden'] ? 'true' : null"
          [attr.aria-live]="aria()['aria-live'] ?? null"
          (error)="view.set('link')"
          [attr.crossorigin]="captions()?.length ? 'anonymous' : null"
          [style]="playerStyle()"
        >
          @for (track of captions() ?? []; track $index) {
            <track
              [src]="track.url"
              [attr.kind]="track.kind ?? 'subtitles'"
              [attr.srclang]="track.language ?? null"
              [attr.label]="track.label ?? null"
              [attr.default]="$index === 0 ? '' : null"
            />
          }
        </video>
      }
      @case ("poster") {
        <button
          type="button"
          [attr.aria-label]="aria()['aria-label'] ?? 'Play ' + (title() ?? 'video')"
          [attr.aria-description]="aria()['aria-description'] ?? null"
          [attr.aria-hidden]="aria()['aria-hidden'] ? 'true' : null"
          [attr.aria-live]="aria()['aria-live'] ?? null"
          (click)="view.set('youtube')"
          [style]="posterStyle()"
        >
          <img
            [src]="poster()"
            alt=""
            style="width: 100%; height: 100%; object-fit: cover; display: block"
          />
          <span aria-hidden="true" [style]="playBadgeStyle">▶</span>
        </button>
      }
      @case ("youtube") {
        <iframe
          [src]="embedUrl()"
          [title]="title() ?? 'YouTube video'"
          [attr.aria-label]="aria()['aria-label'] ?? null"
          [attr.aria-description]="aria()['aria-description'] ?? null"
          [attr.aria-hidden]="aria()['aria-hidden'] ? 'true' : null"
          [attr.aria-live]="aria()['aria-live'] ?? null"
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
          [style]="frameStyle()"
        ></iframe>
      }
    }
    <ng-template #linkBody>
      <span aria-hidden="true" [style]="playCircleStyle">▶</span>
      <span style="font-weight: 500">{{ title() ?? "Watch video" }}</span>
      @if (host(); as host) {
        <span style="opacity: 0.7; font-size: 0.875em">{{ host }}</span>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  host: { style: "display: contents" },
})
export class CopilotGenerativeUIVideo {
  readonly url = input<string>();
  readonly posterUrl = input<string>();
  readonly title = input<string>();
  readonly captions = input<z.output<typeof videoSchema>["captions"]>();
  readonly aspectRatio = input<string>();
  readonly width = input<number | string>();
  readonly maxWidth = input<number | string>();
  readonly weight = input<number>();

  protected readonly aria = injectGenerativeUIAccessibility();
  readonly #sanitizer = inject(DomSanitizer);

  protected readonly youTubeId = computed(() => {
    const url = this.url();
    return url ? youTubeIdOf(url) : undefined;
  });
  /**
   * What the Video shows, derived from `url`: a YouTube video starts on its
   * poster and plays on a press, a file that fails to load becomes a link.
   * A new url derives it again, so a video played before starts on its
   * poster too.
   */
  protected readonly view = linkedSignal<
    "link" | "file" | "poster" | "youtube" | "none"
  >(() => {
    const url = this.url();
    if (!url) return "none";
    if (videoSourceOf(url) === "page") return "link";
    return this.youTubeId() === undefined ? "file" : "poster";
  });
  protected readonly host = computed(() => {
    const url = this.url();
    return url ? hostOf(url) : undefined;
  });
  protected readonly href = computed(() => {
    const url = (this.url() ?? "").trim();
    return /^https?:/i.test(url) ? url : undefined;
  });
  protected readonly poster = computed(
    () =>
      this.posterUrl() ??
      `https://i.ytimg.com/vi/${this.youTubeId()}/hqdefault.jpg`,
  );
  protected readonly embedUrl = computed(() =>
    this.#sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube-nocookie.com/embed/${this.youTubeId()}?autoplay=1`,
    ),
  );
  readonly #box = computed<StyleMap>(() => ({
    display: "block",
    aspectRatio: this.aspectRatio() ?? "16 / 9",
    width: spacing(this.width()) ?? "100%",
    maxWidth: spacing(this.maxWidth()) ?? "100%",
    flexGrow: this.weight(),
    borderRadius: radius("lg"),
  }));
  protected readonly playerStyle = computed<StyleMap>(() => ({
    ...this.#box(),
    background: "#000",
    objectFit: "contain",
  }));
  protected readonly posterStyle = computed<StyleMap>(() => ({
    ...this.#box(),
    position: "relative",
    padding: 0,
    border: "none",
    overflow: "hidden",
    cursor: "pointer",
    background: "#000",
  }));
  protected readonly frameStyle = computed<StyleMap>(() => ({
    ...this.#box(),
    border: 0,
  }));
  protected readonly linkStyle = computed<StyleMap>(() => ({
    ...this.#box(),
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
  protected readonly playCircleStyle: StyleMap = {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "rgba(255,255,255,.15)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
  };
  protected readonly playBadgeStyle: StyleMap = {
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
}

/** An audio player for an audio file URL, with the description above it. */
@Component({
  selector: "figure[copilotGenerativeUIAudioPlayer]",
  template: `
    @if (description(); as description) {
      <figcaption [style]="captionStyle">{{ description }}</figcaption>
    }
    <audio
      controls
      preload="metadata"
      [src]="url()"
      [attr.aria-label]="description() ?? null"
      style="display: block; width: 100%"
    ></audio>
  `,
  host: {
    "data-a2ui-std": "",
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIAudioPlayer {
  readonly url = input<string>();
  readonly description = input<string>();
  readonly weight = input<number>();

  protected readonly aria = injectGenerativeUIAccessibility();
  protected readonly captionStyle: StyleMap = {
    fontSize: ".875em",
    color: textColor("secondary"),
  };
  protected readonly style = computed<StyleMap>(() => ({
    display: "flex",
    flexDirection: "column",
    gap: spacing(1),
    margin: 0,
    width: "100%",
    minWidth: 0,
    flexGrow: this.weight(),
  }));

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}
