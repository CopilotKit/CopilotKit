import React, { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { IconSvg } from "../../components/icons/CopilotIcon";
import type { IconSvgNode } from "../../components/icons/CopilotIcon";
import { z } from "zod";
import {
  controlAria,
  useGenerativeUIAccessibility,
  wrapperAria,
} from "../accessibility";
import type { GenerativeUIInvokeResult } from "../errors";
import { radiusStyle, radiusValue, sizeValue, weightProp } from "./layout";
import { Lightbox, openUrl } from "./lightbox";
import {
  ON_ACCENT,
  WEIGHTS,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
} from "./tokens";
import type { Weight } from "./tokens";

const NO_ARGS = z.object({});
type EventProp = (
  args: z.input<typeof NO_ARGS>,
) => Promise<GenerativeUIInvokeResult>;

// ---- Schemas ----

const colorProp = z.string().optional();

export const ICON_SIZES = ["sm", "md", "lg", "xl"] as const;
export type IconSize = (typeof ICON_SIZES)[number] | number;

const IMAGE_VARIANTS = [
  "icon",
  "avatar",
  "smallFeature",
  "mediumFeature",
  "largeFeature",
  "header",
] as const;
const imageSchema = z.object({
  url: z.string().describe("Image URL"),
  description: z
    .string()
    .optional()
    .describe(
      "What the image shows, for screen readers. Leave it unset only for a decorative image",
    ),
  variant: z
    .enum(IMAGE_VARIANTS)
    .optional()
    .describe(
      'The size: "icon" 24px, "avatar" 40px round, "smallFeature" 160px wide, "largeFeature" and "header" full width. Default "mediumFeature": the natural size',
    ),
  weight: weightProp,
  aspectRatio: z.string().optional(),
  fit: z
    .enum(["cover", "contain", "fill", "none", "scaleDown"])
    .optional()
    .describe('CSS object-fit. Default "cover"'),
  radius: radiusValue.optional(),
  width: sizeValue.optional(),
  height: sizeValue.optional(),
  maxWidth: sizeValue.optional(),
  maxHeight: sizeValue.optional(),
  minWidth: sizeValue.optional(),
  minHeight: sizeValue.optional(),
  background: z.string().optional(),
  frame: z.boolean().optional(),
  position: z
    .string()
    .optional()
    .describe('CSS object-position, for example "top" or "50% 20%"'),
  hideOnFailure: z.boolean().optional().describe("Default false"),
  fallback: z
    .string()
    .optional()
    .describe("Text shown in place of the image when it does not load"),
  hoverZoom: z.boolean().optional().describe("A slight zoom on hover"),
  lightbox: z
    .boolean()
    .optional()
    .describe("Default true: a click opens the image full-screen"),
  actionOverlay: z
    .object({
      label: z.string(),
      icon: z.string().optional().describe("Lucide icon name"),
      href: z.string().optional().describe("Opens this URL in a new tab"),
    })
    .optional()
    .describe(
      "A button over the bottom-right corner of the image. Without href, it sends onOverlayClick",
    ),
});
const iconSchema = z.object({
  name: z
    .union([z.string(), z.object({ svgPath: z.string() })])
    .describe(
      'A Lucide icon name in kebab-case ("arrow-right"), an A2UI icon name ("arrowBack"), or { "svgPath" } on a 24px grid',
    ),
  label: z
    .string()
    .optional()
    .describe(
      "What the icon means, for screen readers. Leave it unset when text next to the icon says the same",
    ),
  size: z
    .union([z.enum(ICON_SIZES), z.number()])
    .optional()
    .describe('Default "md"'),
  color: colorProp,
  inline: z.boolean().optional().describe("Default false"),
  strokeWeight: z.enum(WEIGHTS).optional().describe("The stroke width"),
  weight: weightProp,
});
const faviconSchema = z.object({
  url: z.string(),
  alt: z.string().optional(),
  size: z.number().optional().describe("Pixels. Default 16"),
  inline: z.boolean().optional().describe("Default false"),
  frame: z.boolean().optional().describe("Default false"),
});
const svgSchema = z.object({
  viewBox: z.string().optional(),
  label: z
    .string()
    .optional()
    .describe(
      "What the drawing shows, for screen readers. Leave it unset for a decorative drawing",
    ),
  width: sizeValue.optional(),
  height: sizeValue.optional(),
  size: sizeValue.optional(),
  color: colorProp.describe('Default "prose"'),
  fill: colorProp.describe('Default "currentColor"'),
  stroke: colorProp,
  strokeWidth: z.number().optional(),
  strokeLinecap: z.enum(["butt", "round", "square"]).optional(),
  strokeLinejoin: z.enum(["miter", "round", "bevel"]).optional(),
  preserveAspectRatio: z.string().optional(),
  paths: z
    .array(
      z.object({
        d: z.string(),
        fill: colorProp,
        stroke: colorProp,
        strokeWidth: z.number().optional(),
      }),
    )
    .optional(),
  circles: z
    .array(
      z.object({
        cx: z.number(),
        cy: z.number(),
        r: z.number(),
        fill: colorProp,
        stroke: colorProp,
      }),
    )
    .optional(),
  rects: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        rx: z.number().optional(),
        fill: colorProp,
        stroke: colorProp,
      }),
    )
    .optional(),
  lines: z
    .array(
      z.object({
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
        stroke: colorProp,
      }),
    )
    .optional(),
  texts: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        text: z.string(),
        size: z.number().optional(),
        fill: colorProp,
        anchor: z.enum(["start", "middle", "end"]).optional(),
      }),
    )
    .optional(),
});
const captionTrack = z.object({
  url: z.string().describe("The URL of a WebVTT file"),
  language: z.string().optional().describe('BCP 47, for example "en"'),
  label: z.string().optional().describe("Shown in the captions menu"),
  kind: z.enum(["subtitles", "captions", "descriptions"]).optional(),
});
const videoSchema = z.object({
  url: z
    .string()
    .describe(
      "The URL of a video file, or of a YouTube video or short. A page on another video site shows as a link",
    ),
  posterUrl: z
    .string()
    .optional()
    .describe("The image shown before the video plays"),
  title: z.string().optional().describe("Names the video for screen readers"),
  captions: z
    .array(captionTrack)
    .optional()
    .describe("Caption tracks of a video file"),
  aspectRatio: z.string().optional().describe('Default "16 / 9"'),
  width: sizeValue.optional().describe('Default "100%"'),
  maxWidth: sizeValue.optional().describe('Default "100%"'),
  weight: weightProp,
});
const audioPlayerSchema = z.object({
  url: z.string().describe("The URL of the audio file"),
  description: z
    .string()
    .optional()
    .describe("A title or summary of the audio, shown above the player"),
  weight: weightProp,
});
const htmlViewSchema = z.object({
  html: z.string(),
  height: sizeValue.optional().describe("Pixels when a number. Default 360"),
  width: sizeValue.optional().describe('Default "100%"'),
  title: z.string().optional(),
});

// ---- Helpers ----

/** Pixels when a number, raw CSS when a string. */
export function px(value: number | string | undefined) {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

const ICON_PX: Record<(typeof ICON_SIZES)[number], number> = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};
const ICON_STROKE: Record<Weight, number> = {
  normal: 2,
  medium: 2.25,
  semibold: 2.5,
  bold: 3,
};

/** "arrow-right" gives "ArrowRight". "arrow-down-0-1" gives "ArrowDown01". */
export function kebabToPascal(name: string) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** "ArrowRight" gives "arrow-right", as Lucide names its icon classes. */
function pascalToKebab(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** A Lucide icon as the `lucide` package stores it: `[tag, attributes]` pairs. */
type LucideIconData = [
  tag: string,
  attributes: Record<string, string | number>,
][];
type IconMap = Record<string, LucideIconData>;
let lucidePromise: Promise<IconMap> | null = null;
let lucideIcons: IconMap | null = null;

function loadLucideIcons() {
  lucidePromise ??= import("lucide").then((module) => {
    const icons: IconMap = module.icons;
    lucideIcons = icons;
    return icons;
  });
  return lucidePromise;
}

/**
 * Lucide has about 1,500 icons. A static import of its `icons` map puts all
 * of them in every bundle and makes module load slow. So the map loads once,
 * on first use, and the icons show when it is there.
 */
function useLucideIcons() {
  const [icons, setIcons] = useState(lucideIcons);
  useEffect(() => {
    if (lucideIcons) return;
    let isActive = true;
    void loadLucideIcons().then((loaded) => {
      if (isActive) setIcons(loaded);
    });
    return () => {
      isActive = false;
    };
  }, []);
  return icons;
}

/** The icon for a kebab-case or PascalCase name, or `null` when there is none. */
function findLucideIcon(icons: IconMap, name: string) {
  const pascalName = kebabToPascal(name);
  const key = pascalName in icons ? pascalName : name in icons ? name : null;
  if (key === null) return null;
  const nodes: IconSvgNode[] = icons[key].map(([tag, attributes]) => ({
    tag,
    attributes,
  }));
  return { lucideName: pascalToKebab(key), nodes };
}

/**
 * A lucide icon by kebab-case (or PascalCase) name. An unknown name renders
 * nothing. Without a `label`, the icon is hidden from screen readers.
 *
 * @example
 * ```tsx
 * <LucideIcon name="arrow-right" size="sm" />
 * ```
 */
export function LucideIcon({
  name,
  label,
  description,
  size = "md",
  color,
  weight,
  inline,
  style,
}: {
  name: string;
  label?: string;
  description?: string;
  size?: IconSize;
  color?: string;
  weight?: Weight;
  inline?: boolean;
  style?: CSSProperties;
}) {
  const icons = useLucideIcons();
  if (!name || !icons) return null;
  const icon = findLucideIcon(icons, name);
  if (!icon) return null;
  const pixels =
    typeof size === "number" ? size : inline ? "1em" : ICON_PX[size];
  const a11y =
    label === undefined
      ? { "aria-hidden": true }
      : { role: "img", "aria-label": label, "aria-description": description };
  return (
    <IconSvg
      lucideName={icon.lucideName}
      nodes={icon.nodes}
      {...a11y}
      focusable="false"
      size={pixels}
      color={textColor(color) ?? "currentColor"}
      strokeWidth={weight ? ICON_STROKE[weight] : undefined}
      style={{
        ...style,
        flexShrink: 0,
        display: inline ? "inline-block" : "block",
        verticalAlign: inline ? "-0.125em" : undefined,
      }}
    />
  );
}

// ---- Components ----

type ImageVariantStyle = Pick<
  CSSProperties,
  "width" | "height" | "maxWidth" | "aspectRatio" | "borderRadius"
>;

/** The size of each Image variant. "mediumFeature" is the natural size. */
const IMAGE_VARIANT_STYLE: Record<
  (typeof IMAGE_VARIANTS)[number],
  ImageVariantStyle
> = {
  icon: { width: 24, height: 24, borderRadius: radius("xs") },
  avatar: { width: 40, height: 40, borderRadius: radius("full") },
  smallFeature: { width: "100%", maxWidth: 160 },
  mediumFeature: {},
  largeFeature: { width: "100%" },
  header: { width: "100%", aspectRatio: "3 / 1" },
};

const OBJECT_FIT = {
  cover: "cover",
  contain: "contain",
  fill: "fill",
  none: "none",
  scaleDown: "scale-down",
} as const;

type ImageProps = z.output<typeof imageSchema> & {
  onOverlayClick?: EventProp;
};

function Image(props: ImageProps) {
  const aria = useGenerativeUIAccessibility();
  const [failed, setFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isHidden = failed && props.hideOnFailure;
  if (!props.url || isHidden) return null;
  const showsLightbox = props.lightbox !== false && !failed;
  const alt = props.description ?? "";
  const variant = IMAGE_VARIANT_STYLE[props.variant ?? "mediumFeature"];
  const frame: CSSProperties = {
    display: "block",
    ...variant,
    aspectRatio: props.aspectRatio ?? variant.aspectRatio,
    width:
      spacing(props.width) ??
      (props.aspectRatio ? "100%" : undefined) ??
      variant.width,
    height: spacing(props.height) ?? variant.height,
    minWidth: spacing(props.minWidth),
    minHeight: spacing(props.minHeight),
    maxWidth: spacing(props.maxWidth) ?? variant.maxWidth ?? "100%",
    maxHeight: spacing(props.maxHeight),
    flexGrow: props.weight,
    boxSizing: "border-box",
    ...radiusStyle(props.radius ?? variant.borderRadius),
  };
  if (failed && props.fallback) {
    return (
      <div
        role="img"
        aria-label={alt || props.fallback}
        {...aria}
        style={{
          ...frame,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: spacing(3),
          background: backgroundColor(props.background ?? "surface-secondary"),
          color: textColor("secondary"),
          fontSize: ".875em",
          textAlign: "center",
          minHeight: spacing(props.minHeight) ?? 64,
        }}
      >
        {props.fallback}
      </div>
    );
  }
  const overlay = props.actionOverlay;
  const hasWrapper = overlay !== undefined || props.hoverZoom === true;
  // With an overlay button next to it, hidden and live belong to the pair;
  // the name stays on the image, because names do not inherit.
  const image = (
    <img
      src={props.url}
      alt={alt}
      {...(hasWrapper ? controlAria(aria) : aria)}
      loading="lazy"
      onError={() => setFailed(true)}
      onClick={showsLightbox ? () => setIsOpen(true) : undefined}
      data-a2ui-lightbox-trigger={showsLightbox ? "" : undefined}
      style={{
        ...frame,
        cursor: showsLightbox ? "zoom-in" : undefined,
        objectFit: OBJECT_FIT[props.fit ?? "cover"],
        objectPosition: props.position,
        background: backgroundColor(props.background),
        border: props.frame ? `1px solid ${borderColor("default")}` : undefined,
        transform: props.hoverZoom && isHovered ? "scale(1.03)" : undefined,
        transition: props.hoverZoom ? "transform .2s ease" : undefined,
      }}
    />
  );
  return (
    <>
      {isOpen && showsLightbox ? (
        <Lightbox
          images={[{ src: props.url, alt }]}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
      {hasWrapper ? (
        <div
          {...wrapperAria(aria)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            position: "relative",
            display: "inline-block",
            maxWidth: "100%",
            overflow: props.hoverZoom ? "hidden" : undefined,
            ...radiusStyle(props.radius),
          }}
        >
          {image}
          {overlay ? (
            <button
              type="button"
              data-a2ui-input=""
              onClick={(event) => {
                event.stopPropagation();
                if (overlay.href) openUrl(overlay.href);
                else void props.onOverlayClick?.({});
              }}
              style={{
                position: "absolute",
                right: 8,
                bottom: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 9999,
                border: "none",
                background: "var(--a2ui-color-overlay, rgba(0,0,0,.65))",
                color: ON_ACCENT,
                font: "inherit",
                fontSize: ".8125em",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {overlay.icon ? (
                <LucideIcon name={overlay.icon} size={14} />
              ) : null}
              {overlay.label}
            </button>
          ) : null}
        </div>
      ) : (
        image
      )}
    </>
  );
}

/** The A2UI basic catalog icon names, and the Lucide icon of each. */
const A2UI_ICONS: Record<string, string> = {
  accountCircle: "circle-user",
  add: "plus",
  arrowBack: "arrow-left",
  arrowForward: "arrow-right",
  attachFile: "paperclip",
  calendarToday: "calendar",
  call: "phone",
  camera: "camera",
  check: "check",
  close: "x",
  delete: "trash-2",
  download: "download",
  edit: "pencil",
  event: "calendar-days",
  error: "circle-alert",
  fastForward: "fast-forward",
  favorite: "heart",
  favoriteOff: "heart-off",
  folder: "folder",
  help: "circle-question-mark",
  home: "house",
  info: "info",
  locationOn: "map-pin",
  lock: "lock",
  lockOpen: "lock-open",
  mail: "mail",
  menu: "menu",
  moreVert: "ellipsis-vertical",
  moreHoriz: "ellipsis",
  notificationsOff: "bell-off",
  notifications: "bell",
  pause: "pause",
  payment: "credit-card",
  person: "user",
  phone: "phone",
  photo: "image",
  play: "play",
  print: "printer",
  refresh: "refresh-cw",
  rewind: "rewind",
  search: "search",
  send: "send",
  settings: "settings",
  share: "share-2",
  shoppingCart: "shopping-cart",
  skipNext: "skip-forward",
  skipPrevious: "skip-back",
  star: "star",
  starHalf: "star-half",
  starOff: "star-off",
  stop: "square",
  upload: "upload",
  visibility: "eye",
  visibilityOff: "eye-off",
  volumeDown: "volume-1",
  volumeMute: "volume-x",
  volumeOff: "volume-off",
  volumeUp: "volume-2",
  warning: "triangle-alert",
};

/** The Lucide name of an icon: an A2UI name maps, any other name passes. */
export function lucideNameOf(name: string) {
  return A2UI_ICONS[name] ?? name;
}

function Icon(props: z.output<typeof iconSchema>) {
  const aria = useGenerativeUIAccessibility();
  // The envelope names the icon like `label` does.
  const label = aria["aria-label"] ?? props.label;
  const size = props.size ?? "md";
  const style = { flexGrow: props.weight };
  if (typeof props.name === "object") {
    const pixels =
      typeof size === "number" ? size : props.inline ? "1em" : ICON_PX[size];
    const a11y =
      label === undefined
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label": label,
            "aria-description": aria["aria-description"],
          };
    return (
      <svg
        {...a11y}
        focusable="false"
        viewBox="0 0 24 24"
        width={pixels}
        height={pixels}
        fill={textColor(props.color) ?? "currentColor"}
        style={{
          ...style,
          flexShrink: 0,
          display: props.inline ? "inline-block" : "block",
          verticalAlign: props.inline ? "-0.125em" : undefined,
        }}
      >
        <path d={props.name.svgPath} />
      </svg>
    );
  }
  return (
    <LucideIcon
      name={lucideNameOf(props.name)}
      label={label}
      description={aria["aria-description"]}
      size={size}
      color={props.color}
      weight={props.strokeWeight}
      inline={props.inline}
      style={style}
    />
  );
}

export function hostOf(url: string) {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
}

function Favicon(props: z.output<typeof faviconSchema>) {
  const host = hostOf(props.url);
  if (!host) return null;
  const size = props.size ?? 16;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt={props.alt ?? host}
      width={size}
      height={size}
      style={{
        display: props.inline ? "inline-block" : "block",
        verticalAlign: props.inline ? "middle" : undefined,
        borderRadius: radius("xs"),
        border: props.frame ? `1px solid ${borderColor("default")}` : undefined,
        padding: props.frame ? 2 : undefined,
        background: props.frame ? backgroundColor("surface") : undefined,
      }}
    />
  );
}

/**
 * A vector drawing from primitive shapes only. It has no raw markup, so the
 * model cannot add scripts or event handlers. A number size is pixels (not
 * 4px steps like the layout spacing).
 */
function Svg(props: z.output<typeof svgSchema>) {
  const aria = useGenerativeUIAccessibility();
  const label = aria["aria-label"] ?? props.label;
  const a11y =
    label === undefined
      ? { "aria-hidden": true }
      : {
          role: "img",
          "aria-label": label,
          "aria-description": aria["aria-description"],
        };
  const rects = props.rects ?? [];
  const circles = props.circles ?? [];
  const paths = props.paths ?? [];
  const lines = props.lines ?? [];
  const texts = props.texts ?? [];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      {...a11y}
      focusable="false"
      viewBox={props.viewBox}
      width={props.width ?? props.size ?? "100%"}
      height={props.height ?? props.size}
      fill={textColor(props.fill) ?? "currentColor"}
      stroke={textColor(props.stroke)}
      strokeWidth={props.strokeWidth}
      strokeLinecap={props.strokeLinecap}
      strokeLinejoin={props.strokeLinejoin}
      preserveAspectRatio={props.preserveAspectRatio}
      style={{ color: textColor(props.color ?? "prose"), display: "block" }}
    >
      {rects.map((rect, index) => (
        <rect
          key={`r${index}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={rect.rx}
          fill={textColor(rect.fill)}
          stroke={textColor(rect.stroke)}
        />
      ))}
      {circles.map((circle, index) => (
        <circle
          key={`c${index}`}
          cx={circle.cx}
          cy={circle.cy}
          r={circle.r}
          fill={textColor(circle.fill)}
          stroke={textColor(circle.stroke)}
        />
      ))}
      {paths.map((path, index) => (
        <path
          key={`p${index}`}
          d={path.d}
          fill={textColor(path.fill)}
          stroke={textColor(path.stroke)}
          strokeWidth={path.strokeWidth}
        />
      ))}
      {lines.map((line, index) => (
        <line
          key={`l${index}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={textColor(line.stroke) ?? "currentColor"}
        />
      ))}
      {texts.map((text, index) => (
        <text
          key={`t${index}`}
          x={text.x}
          y={text.y}
          fontSize={text.size}
          fill={textColor(text.fill)}
          textAnchor={text.anchor}
          stroke="none"
        >
          {text.text}
        </text>
      ))}
    </svg>
  );
}

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

type VideoProps = z.output<typeof videoSchema>;

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

export type VideoSource = "youtube" | "file" | "page";

/**
 * How to show a video URL: the YouTube embed, the native player for a file
 * (a known extension, or any URL that is not a page of a video site), or a
 * link for a page the player cannot play. A URL that does not parse is a
 * file: the player reports the failure, and the link takes its place.
 */
export function videoSourceOf(url: string): VideoSource {
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

/** A link to a video that cannot play here, in place of a dead player. */
function VideoLink({
  url,
  title,
  box,
  aria,
}: {
  url: string;
  title: string | undefined;
  box: CSSProperties;
  aria: ReturnType<typeof useGenerativeUIAccessibility>;
}) {
  const href = /^https?:/i.test(url.trim()) ? url.trim() : undefined;
  const host = hostOf(url);
  const body = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "rgba(255,255,255,.15)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
        }}
      >
        ▶
      </span>
      <span style={{ fontWeight: 500 }}>{title ?? "Watch video"}</span>
      {host ? (
        <span style={{ opacity: 0.7, fontSize: ".875em" }}>{host}</span>
      ) : null}
    </>
  );
  const style: CSSProperties = {
    ...box,
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
  };
  if (href === undefined) {
    return (
      <span data-a2ui-video-link="" {...aria} style={style}>
        {body}
      </span>
    );
  }
  return (
    <a
      data-a2ui-video-link=""
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${title ?? "video"} on ${host ?? "its site"}`}
      {...aria}
      style={style}
    >
      {body}
    </a>
  );
}

/*
 * The YouTube player is cross-origin (youtube-nocookie.com). So
 * allow-same-origin only lets it use its own origin. It cannot get to the
 * host page.
 */
function Video(props: VideoProps) {
  const aria = useGenerativeUIAccessibility();
  const [isPlaying, setIsPlaying] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const youTubeId = youTubeIdOf(props.url);
  const box: CSSProperties = {
    display: "block",
    aspectRatio: props.aspectRatio ?? "16 / 9",
    width: spacing(props.width) ?? "100%",
    maxWidth: spacing(props.maxWidth) ?? "100%",
    flexGrow: props.weight,
    borderRadius: radius("lg"),
  };
  const source = videoSourceOf(props.url);
  if (source === "page" || failedUrl === props.url) {
    return (
      <VideoLink url={props.url} title={props.title} box={box} aria={aria} />
    );
  }
  if (youTubeId === undefined) {
    return (
      <video
        controls
        preload="metadata"
        src={props.url}
        poster={props.posterUrl}
        title={props.title}
        aria-label={props.title}
        {...aria}
        // A file that does not load leaves a dead player; a link is better.
        onError={() => setFailedUrl(props.url)}
        // Tracks load in the CORS mode of their media element; without one,
        // a caption file on another host never loads.
        crossOrigin={props.captions?.length ? "anonymous" : undefined}
        style={{ ...box, background: "#000", objectFit: "contain" }}
      >
        {(props.captions ?? []).map((track, index) => (
          <track
            key={`${track.url}-${index}`}
            src={track.url}
            kind={track.kind ?? "subtitles"}
            srcLang={track.language}
            label={track.label}
            default={index === 0 ? true : undefined}
          />
        ))}
      </video>
    );
  }
  // The poster first: no third-party script runs until the user asks to play.
  if (!isPlaying) {
    return (
      <button
        type="button"
        aria-label={`Play ${props.title ?? "video"}`}
        {...aria}
        onClick={() => setIsPlaying(true)}
        style={{
          ...box,
          position: "relative",
          padding: 0,
          border: "none",
          overflow: "hidden",
          cursor: "pointer",
          background: "#000",
        }}
      >
        <img
          src={
            props.posterUrl ??
            `https://i.ytimg.com/vi/${youTubeId}/hqdefault.jpg`
          }
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 56,
            height: 40,
            borderRadius: 12,
            background: "rgba(0,0,0,.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 18,
          }}
        >
          ▶
        </span>
      </button>
    );
  }
  return (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${youTubeId}?autoplay=1`}
      title={props.title ?? "YouTube video"}
      {...aria}
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      style={{ ...box, border: 0 }}
    />
  );
}

function AudioPlayer(props: z.output<typeof audioPlayerSchema>) {
  const aria = useGenerativeUIAccessibility();
  return (
    <figure
      data-a2ui-std=""
      {...aria}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing(1),
        margin: 0,
        width: "100%",
        minWidth: 0,
        flexGrow: props.weight,
      }}
    >
      {props.description ? (
        <figcaption
          style={{ fontSize: ".875em", color: textColor("secondary") }}
        >
          {props.description}
        </figcaption>
      ) : null}
      <audio
        controls
        preload="metadata"
        src={props.url}
        aria-label={props.description}
        style={{ display: "block", width: "100%" }}
      />
    </figure>
  );
}

function HtmlView(props: z.output<typeof htmlViewSchema>) {
  return (
    <iframe
      // An empty sandbox: no scripts, no same origin, no forms, no popups.
      sandbox=""
      srcDoc={props.html}
      title={props.title ?? "HTML content"}
      style={{
        display: "block",
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("md"),
        height: px(props.height ?? 360),
        width: px(props.width ?? "100%"),
        background: backgroundColor("surface"),
      }}
    />
  );
}

/**
 * The standard media components. Give them to
 * `createGenerativeUI({ components: { ...mediaComponents } })`.
 */
export const mediaComponents = {
  Image: {
    component: Image,
    description:
      "An image from a URL. A click opens it full-screen. Set description to say what the image shows, unless it is only decoration.",
    props: imageSchema,
    events: {
      onOverlayClick: {
        description:
          "Sent when the user clicks the actionOverlay button and it has no href.",
        parameters: NO_ARGS,
      },
    },
  },
  Icon: {
    component: Icon,
    description:
      'A Lucide icon by kebab-case name (for example "arrow-right"), or an A2UI icon name (for example "arrowBack"). Set label when no text next to the icon says what it means.',
    props: iconSchema,
  },
  Favicon: {
    component: Favicon,
    description: "The favicon of the site at a URL.",
    props: faviconSchema,
  },
  Svg: {
    component: Svg,
    description:
      "A vector drawing from primitive shapes (paths, circles, rects, lines, texts). Colors take text color tokens or CSS colors.",
    props: svgSchema,
  },
  Video: {
    component: Video,
    description:
      "A video player for a video file URL (with optional captions), or a YouTube link in privacy-enhanced mode: the poster shows first, and the player loads when the user presses play. A page on another video site shows as a link to it. Set title to name the video.",
    props: videoSchema,
  },
  AudioPlayer: {
    component: AudioPlayer,
    description:
      "An audio player for an audio file URL, with the description above it.",
    props: audioPlayerSchema,
  },
  HtmlView: {
    component: HtmlView,
    description:
      "Raw HTML in a fully sandboxed iframe: no scripts, no same-origin access. Set title to name the content.",
    props: htmlViewSchema,
  },
};
