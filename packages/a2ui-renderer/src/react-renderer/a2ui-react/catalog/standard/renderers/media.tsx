import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { safeHref } from "../inline-markdown";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { mediaDefinitions } from "../definitions/media";
import type { LayoutProps } from "../definitions/layout";
import {
  BACKDROP,
  ON_ACCENT,
  SHADOW_MD,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
} from "../tokens";

/** Pixels when a number, raw CSS when a string. */
export const px = (v: number | string | undefined): string | undefined =>
  v === undefined || v === null
    ? undefined
    : typeof v === "number"
      ? `${v}px`
      : v;

const ICON_PX: Record<string, number> = { sm: 16, md: 20, lg: 24, xl: 32 };
const ICON_STROKE: Record<string, number> = {
  normal: 2,
  medium: 2.25,
  semibold: 2.5,
  bold: 3,
};

/** "arrow-right" → "ArrowRight", "arrow-down-0-1" → "ArrowDown01". */
export function kebabToPascal(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

type IconMap = Record<string, React.ComponentType<any>>;
let lucidePromise: Promise<IconMap> | null = null;
let lucideIcons: IconMap | null = null;
/**
 * lucide-react ships ~1,500 icons; importing its `icons` map statically would
 * drag all of them into every consumer bundle and slow module evaluation.
 * Load the map once, on first use, and let icons fade in when it arrives.
 */
function useLucideIcons(): IconMap | null {
  const [map, setMap] = React.useState<IconMap | null>(lucideIcons);
  React.useEffect(() => {
    if (lucideIcons) return;
    lucidePromise ??= import("lucide-react").then((m) => {
      lucideIcons = m.icons as IconMap;
      return lucideIcons;
    });
    let active = true;
    lucidePromise.then((m) => {
      if (active) setMap(m);
    });
    return () => {
      active = false;
    };
  }, []);
  return map;
}

/** Lucide icon by kebab-case (or PascalCase) name; unknown names render nothing. */
export function LucideIcon({
  name,
  size = "md",
  color,
  weight,
  inline,
}: {
  name: string | undefined;
  size?: string | number;
  color?: string;
  weight?: string;
  inline?: boolean;
}) {
  const icons = useLucideIcons();
  if (!name || !icons) return null;
  const Component = icons[kebabToPascal(name)] ?? icons[name];
  if (!Component) return null;
  const pixels =
    typeof size === "number" ? size : inline ? "1em" : (ICON_PX[size] ?? 20);
  return (
    <Component
      aria-hidden
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

function radiusCss(value: LayoutProps["radius"]): React.CSSProperties {
  if (typeof value === "string" || typeof value === "number") {
    return { borderRadius: radius(value) };
  }
  if (value) {
    return {
      borderTopLeftRadius: radius(value.topLeft),
      borderTopRightRadius: radius(value.topRight),
      borderBottomLeftRadius: radius(value.bottomLeft),
      borderBottomRightRadius: radius(value.bottomRight),
    };
  }
  return {};
}

export interface LightboxImage {
  src: string;
  alt?: string;
}

const LIGHTBOX_BUTTON: React.CSSProperties = {
  position: "absolute",
  border: "none",
  borderRadius: 9999,
  background: "rgba(255,255,255,.15)",
  color: ON_ACCENT,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/**
 * Full-screen view of one or more images. Closes on click, Escape or the
 * close button; with several images the arrows and the arrow keys move
 * between them.
 */
export function Lightbox({
  images,
  index = 0,
  onClose,
}: {
  images: LightboxImage[];
  index?: number;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(index);
  const count = images.length;
  const step = (delta: number) =>
    setCurrent((i) => (count === 0 ? 0 : (i + delta + count) % count));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && count > 1) step(1);
      else if (e.key === "ArrowLeft" && count > 1) step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, count]);
  if (typeof document === "undefined") return null;
  const image = images[Math.min(current, count - 1)];
  if (!image) return null;
  const alt = image.alt ?? "";
  const arrow = (delta: -1 | 1) => (
    <button
      type="button"
      aria-label={delta < 0 ? "Previous image" : "Next image"}
      data-a2ui-lightbox-arrow={delta < 0 ? "prev" : "next"}
      onClick={(e) => {
        e.stopPropagation();
        step(delta);
      }}
      style={{
        ...LIGHTBOX_BUTTON,
        top: "50%",
        [delta < 0 ? "left" : "right"]: 16,
        transform: "translateY(-50%)",
        width: 44,
        height: 44,
        fontSize: 28,
        lineHeight: 1,
      }}
    >
      {delta < 0 ? "‹" : "›"}
    </button>
  );
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image"}
      data-a2ui-lightbox=""
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: BACKDROP,
        cursor: "zoom-out",
      }}
    >
      <img
        key={image.src}
        src={image.src}
        alt={alt}
        style={{
          maxWidth: "min(92vw, 1400px)",
          maxHeight: "92vh",
          objectFit: "contain",
          borderRadius: radius("md"),
          boxShadow: SHADOW_MD,
        }}
      />
      {count > 1 ? (
        <span
          data-a2ui-lightbox-counter=""
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            color: ON_ACCENT,
            fontSize: 13,
            opacity: 0.8,
          }}
        >
          {current + 1} / {count}
        </span>
      ) : null}
      {count > 1 ? arrow(-1) : null}
      {count > 1 ? arrow(1) : null}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          ...LIGHTBOX_BUTTON,
          top: 16,
          right: 16,
          width: 36,
          height: 36,
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}

function Image({ props, dispatch }: RendererProps<any>) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  if (!props.src || (failed && props.hideOnFailure)) return null;
  const lightbox = props.lightbox !== false && !failed;
  const src = String(props.src);
  const alt = props.alt ?? "";
  const frame: React.CSSProperties = {
    display: "block",
    aspectRatio: props.aspectRatio,
    width: spacing(props.width) ?? (props.aspectRatio ? "100%" : undefined),
    height: spacing(props.height),
    minWidth: spacing(props.minWidth),
    minHeight: spacing(props.minHeight),
    maxWidth: spacing(props.maxWidth) ?? "100%",
    maxHeight: spacing(props.maxHeight),
    boxSizing: "border-box",
    ...radiusCss(props.radius),
  };
  if (failed && props.fallback) {
    return (
      <div
        role="img"
        aria-label={alt || String(props.fallback)}
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
        {String(props.fallback)}
      </div>
    );
  }
  const overlay = props.actionOverlay;
  const img = (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      onClick={lightbox ? () => setOpen(true) : undefined}
      data-a2ui-lightbox-trigger={lightbox ? "" : undefined}
      style={{
        ...frame,
        cursor: lightbox ? "zoom-in" : undefined,
        objectFit: props.fit ?? "cover",
        objectPosition: props.position,
        background: backgroundColor(props.background),
        border: props.frame ? `1px solid ${borderColor("default")}` : undefined,
        transform: props.hoverZoom && hover ? "scale(1.03)" : undefined,
        transition: props.hoverZoom ? "transform .2s ease" : undefined,
      }}
    />
  );
  return (
    <>
      {open && lightbox ? (
        <Lightbox images={[{ src, alt }]} onClose={() => setOpen(false)} />
      ) : null}
      {overlay || props.hoverZoom ? (
        <div
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            position: "relative",
            display: "inline-block",
            maxWidth: "100%",
            overflow: props.hoverZoom ? "hidden" : undefined,
            ...radiusCss(props.radius),
          }}
        >
          {img}
          {overlay ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (overlay.href) {
                  const safe = safeHref(overlay.href);
                  if (safe && typeof window !== "undefined") {
                    window.open(safe, "_blank", "noopener,noreferrer");
                  }
                } else if (typeof overlay.action === "function") {
                  (overlay.action as () => void)();
                } else if (overlay.action) {
                  dispatch?.(overlay.action);
                }
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
        img
      )}
    </>
  );
}

function Icon({ props }: RendererProps<any>) {
  return (
    <LucideIcon
      name={props.name}
      size={props.size ?? "md"}
      color={props.color}
      weight={props.weight}
      inline={props.inline}
    />
  );
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
}

function Favicon({ props }: RendererProps<any>) {
  const host = props.url ? hostOf(String(props.url)) : undefined;
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

/** Svg dimensions are pixels when numeric (not 4px steps like layout spacing). */
const svgDim = (v: unknown): string | number | undefined =>
  typeof v === "number" || typeof v === "string" ? v : undefined;

function Svg({ props }: RendererProps<any>) {
  const size = svgDim(props.size);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={props.viewBox}
      width={svgDim(props.width) ?? size ?? "100%"}
      height={svgDim(props.height) ?? size}
      fill={textColor(props.fill) ?? "currentColor"}
      stroke={textColor(props.stroke)}
      strokeWidth={props.strokeWidth}
      strokeLinecap={props.strokeLinecap}
      strokeLinejoin={props.strokeLinejoin}
      preserveAspectRatio={props.preserveAspectRatio}
      style={{ color: textColor(props.color ?? "prose"), display: "block" }}
    >
      {(props.rects ?? []).map((r: any, i: number) => (
        <rect
          key={`r${i}`}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={r.rx}
          fill={textColor(r.fill)}
          stroke={textColor(r.stroke)}
        />
      ))}
      {(props.circles ?? []).map((c: any, i: number) => (
        <circle
          key={`c${i}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill={textColor(c.fill)}
          stroke={textColor(c.stroke)}
        />
      ))}
      {(props.paths ?? []).map((p: any, i: number) => (
        <path
          key={`p${i}`}
          d={p.d}
          fill={textColor(p.fill)}
          stroke={textColor(p.stroke)}
          strokeWidth={p.strokeWidth}
        />
      ))}
      {(props.lines ?? []).map((l: any, i: number) => (
        <line
          key={`l${i}`}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={textColor(l.stroke) ?? "currentColor"}
        />
      ))}
      {(props.texts ?? []).map((t: any, i: number) => (
        <text
          key={`t${i}`}
          x={t.x}
          y={t.y}
          fontSize={t.size}
          fill={textColor(t.fill)}
          textAnchor={t.anchor}
          stroke="none"
        >
          {t.text}
        </text>
      ))}
    </svg>
  );
}

/** YouTube ids are 11 chars of [A-Za-z0-9_-]; anything else is rejected. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

/*
 * The player is cross-origin (youtube-nocookie.com), so allow-same-origin
 * only lets it use its own origin; it cannot reach the host page.
 */
function YouTube({ props }: RendererProps<any>) {
  const id = String(props.videoId ?? "");
  const [playing, setPlaying] = useState(false);
  if (!YOUTUBE_ID.test(id)) return null;
  const box: React.CSSProperties = {
    display: "block",
    aspectRatio: props.aspectRatio ?? "16 / 9",
    width: spacing(props.width) ?? "100%",
    maxWidth: spacing(props.maxWidth) ?? "100%",
    borderRadius: radius("lg"),
  };
  // Poster first: no third-party script runs until the user asks to play.
  if (props.showThumbnail !== false && !playing) {
    return (
      <button
        type="button"
        aria-label={`Play ${props.title ?? "video"}`}
        onClick={() => setPlaying(true)}
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
          src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
        <span
          aria-hidden
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
      src={`https://www.youtube-nocookie.com/embed/${id}${playing ? "?autoplay=1" : ""}`}
      title={props.title ?? "YouTube video"}
      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      style={{ ...box, border: 0 }}
    />
  );
}

function HtmlView({ props }: RendererProps<any>) {
  return (
    <iframe
      // Empty sandbox: no scripts, no same-origin, no forms, no popups.
      sandbox=""
      srcDoc={props.html ?? ""}
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

export const mediaRenderers = {
  Image,
  Icon,
  Favicon,
  Svg,
  YouTube,
  HtmlView,
} satisfies CatalogRenderers<typeof mediaDefinitions>;
