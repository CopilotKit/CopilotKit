import React, { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { LucideIcon as LucideComponent } from "lucide-react";
import { z } from "zod";
import type { GenerativeUIInvokeResult } from "../errors";
import { radiusStyle, radiusValue, sizeValue } from "./layout";
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

const imageSchema = z.object({
  src: z.string().describe("Image URL"),
  alt: z
    .string()
    .optional()
    .describe(
      "What the image shows. Leave it unset only for a decorative image",
    ),
  aspectRatio: z.string().optional(),
  fit: z.enum(["cover", "contain"]).optional().describe('Default "cover"'),
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
  name: z.string().describe("Lucide icon name, kebab-case"),
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
  weight: z.enum(WEIGHTS).optional(),
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
const youTubeSchema = z.object({
  videoId: z.string(),
  title: z.string().optional(),
  showThumbnail: z
    .boolean()
    .optional()
    .describe(
      "Default true: the poster with a play button shows first, and the player loads on click",
    ),
  aspectRatio: z.string().optional().describe('Default "16 / 9"'),
  width: sizeValue.optional().describe('Default "100%"'),
  maxWidth: sizeValue.optional().describe('Default "100%"'),
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

type IconMap = Record<string, LucideComponent>;
let lucidePromise: Promise<IconMap> | null = null;
let lucideIcons: IconMap | null = null;

function loadLucideIcons() {
  lucidePromise ??= import("lucide-react").then((module) => {
    const icons: IconMap = module.icons;
    lucideIcons = icons;
    return icons;
  });
  return lucidePromise;
}

/**
 * lucide-react has about 1,500 icons. A static import of its `icons` map
 * puts all of them in every bundle and makes module load slow. So the map
 * loads once, on first use, and the icons show when it is there.
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
  size = "md",
  color,
  weight,
  inline,
}: {
  name: string;
  label?: string;
  size?: IconSize;
  color?: string;
  weight?: Weight;
  inline?: boolean;
}) {
  const icons = useLucideIcons();
  if (!name || !icons) return null;
  const IconComponent = icons[kebabToPascal(name)] ?? icons[name];
  if (!IconComponent) return null;
  const pixels =
    typeof size === "number" ? size : inline ? "1em" : ICON_PX[size];
  const a11y =
    label === undefined
      ? { "aria-hidden": true }
      : { role: "img", "aria-label": label };
  return (
    <IconComponent
      {...a11y}
      focusable="false"
      width={pixels}
      height={pixels}
      color={textColor(color) ?? "currentColor"}
      strokeWidth={weight ? ICON_STROKE[weight] : undefined}
      style={{
        flexShrink: 0,
        display: inline ? "inline-block" : "block",
        verticalAlign: inline ? "-0.125em" : undefined,
      }}
    />
  );
}

// ---- Components ----

type ImageProps = z.output<typeof imageSchema> & {
  onOverlayClick?: EventProp;
};

function Image(props: ImageProps) {
  const [failed, setFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isHidden = failed && props.hideOnFailure;
  if (!props.src || isHidden) return null;
  const showsLightbox = props.lightbox !== false && !failed;
  const alt = props.alt ?? "";
  const frame: CSSProperties = {
    display: "block",
    aspectRatio: props.aspectRatio,
    width: spacing(props.width) ?? (props.aspectRatio ? "100%" : undefined),
    height: spacing(props.height),
    minWidth: spacing(props.minWidth),
    minHeight: spacing(props.minHeight),
    maxWidth: spacing(props.maxWidth) ?? "100%",
    maxHeight: spacing(props.maxHeight),
    boxSizing: "border-box",
    ...radiusStyle(props.radius),
  };
  if (failed && props.fallback) {
    return (
      <div
        role="img"
        aria-label={alt || props.fallback}
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
  const image = (
    <img
      src={props.src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      onClick={showsLightbox ? () => setIsOpen(true) : undefined}
      data-a2ui-lightbox-trigger={showsLightbox ? "" : undefined}
      style={{
        ...frame,
        cursor: showsLightbox ? "zoom-in" : undefined,
        objectFit: props.fit ?? "cover",
        objectPosition: props.position,
        background: backgroundColor(props.background),
        border: props.frame ? `1px solid ${borderColor("default")}` : undefined,
        transform: props.hoverZoom && isHovered ? "scale(1.03)" : undefined,
        transition: props.hoverZoom ? "transform .2s ease" : undefined,
      }}
    />
  );
  const hasWrapper = overlay !== undefined || props.hoverZoom === true;
  return (
    <>
      {isOpen && showsLightbox ? (
        <Lightbox
          images={[{ src: props.src, alt }]}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
      {hasWrapper ? (
        <div
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

function Icon(props: z.output<typeof iconSchema>) {
  return (
    <LucideIcon
      name={props.name}
      label={props.label}
      size={props.size ?? "md"}
      color={props.color}
      weight={props.weight}
      inline={props.inline}
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
  const a11y =
    props.label === undefined
      ? { "aria-hidden": true }
      : { role: "img", "aria-label": props.label };
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

/*
 * The player is cross-origin (youtube-nocookie.com). So allow-same-origin
 * only lets it use its own origin. It cannot get to the host page.
 */
function YouTube(props: z.output<typeof youTubeSchema>) {
  const [isPlaying, setIsPlaying] = useState(false);
  if (!YOUTUBE_ID.test(props.videoId)) return null;
  const box: CSSProperties = {
    display: "block",
    aspectRatio: props.aspectRatio ?? "16 / 9",
    width: spacing(props.width) ?? "100%",
    maxWidth: spacing(props.maxWidth) ?? "100%",
    borderRadius: radius("lg"),
  };
  // The poster first: no third-party script runs until the user asks to play.
  if (props.showThumbnail !== false && !isPlaying) {
    return (
      <button
        type="button"
        aria-label={`Play ${props.title ?? "video"}`}
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
          src={`https://i.ytimg.com/vi/${props.videoId}/hqdefault.jpg`}
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
      src={`https://www.youtube-nocookie.com/embed/${props.videoId}${isPlaying ? "?autoplay=1" : ""}`}
      title={props.title ?? "YouTube video"}
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      style={{ ...box, border: 0 }}
    />
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
      "An image from a URL. A click opens it full-screen. Set alt to say what the image shows, unless it is only decoration.",
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
      'A Lucide icon by kebab-case name (for example "arrow-right"). Set label when no text next to the icon says what it means.',
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
  YouTube: {
    component: YouTube,
    description:
      "An embedded YouTube video, in privacy-enhanced mode. The poster shows first, and the player loads when the user presses play. Set title to name the video.",
    props: youTubeSchema,
  },
  HtmlView: {
    component: HtmlView,
    description:
      "Raw HTML in a fully sandboxed iframe: no scripts, no same-origin access. Set title to name the content.",
    props: htmlViewSchema,
  },
};
