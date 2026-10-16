import React, { useState } from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { mediaDefinitions } from "../definitions/media";
import type { LayoutProps } from "../definitions/layout";
import {
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

function Image({ props }: RendererProps<any>) {
  const [failed, setFailed] = useState(false);
  if (!props.src || (failed && props.hideOnFailure)) return null;
  return (
    <img
      src={String(props.src)}
      alt={props.alt ?? ""}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{
        display: "block",
        objectFit: props.fit ?? "cover",
        aspectRatio: props.aspectRatio,
        width: spacing(props.width) ?? (props.aspectRatio ? "100%" : undefined),
        height: spacing(props.height),
        maxWidth: spacing(props.maxWidth) ?? "100%",
        maxHeight: spacing(props.maxHeight),
        background: backgroundColor(props.background),
        border: props.frame ? `1px solid ${borderColor("default")}` : undefined,
        boxSizing: "border-box",
        ...radiusCss(props.radius),
      }}
    />
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

function hostOf(url: string): string | undefined {
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
  if (!YOUTUBE_ID.test(id)) return null;
  return (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${id}`}
      title={props.title ?? "YouTube video"}
      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      style={{
        display: "block",
        border: 0,
        aspectRatio: props.aspectRatio ?? "16 / 9",
        width: spacing(props.width) ?? "100%",
        maxWidth: spacing(props.maxWidth) ?? "100%",
        borderRadius: radius("lg"),
      }}
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
