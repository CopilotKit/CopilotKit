import React, { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { textDefinitions } from "../definitions/text";
import { renderInlineMarkdown } from "../inline-markdown";
import { renderChildren } from "./layout";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "../tokens";
import type { TitleSize, Weight } from "../tokens";
import { useStandardStyles } from "../styles";

const SAFE_URL = /^(https?:|mailto:)/i;
const safeHref = (href: unknown) =>
  typeof href === "string" && SAFE_URL.test(href.trim())
    ? href.trim()
    : undefined;

/**
 * Heading level per size. Sizes come from the host's heading styles (the
 * chat's prose), with zero-specificity fallbacks in `styles.ts`.
 */
const TITLE_TAG: Record<TitleSize, "h2" | "h3" | "h4"> = {
  sm: "h4",
  md: "h3",
  lg: "h3",
  xl: "h2",
  "2xl": "h2",
  "3xl": "h2",
  "4xl": "h2",
  "5xl": "h2",
};

const HIGHLIGHT: Record<string, string> = {
  green: "var(--a2ui-color-highlight-green, #d3f5e4)",
  orange: "var(--a2ui-color-highlight-orange, #ffe7c7)",
  pink: "var(--a2ui-color-highlight-pink, #fde0ef)",
};

interface TypographyProps {
  color?: string;
  weight?: Weight;
  textAlign?: "start" | "center" | "end";
  italic?: boolean;
  truncate?: boolean;
  maxLines?: number;
  tabularNums?: boolean;
  width?: number | string;
}

function typographyStyle(p: TypographyProps): React.CSSProperties {
  const clamp: React.CSSProperties = p.truncate
    ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
    : p.maxLines
      ? {
          display: "-webkit-box",
          WebkitLineClamp: p.maxLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }
      : {};
  return {
    margin: 0,
    color: textColor(p.color),
    fontWeight: p.weight ? FONT_WEIGHT[p.weight] : undefined,
    textAlign: p.textAlign,
    fontStyle: p.italic ? "italic" : undefined,
    fontVariantNumeric: p.tabularNums ? "tabular-nums" : undefined,
    width: spacing(p.width),
    ...clamp,
  };
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

const SHIMMER_STYLE_ID = "a2ui-standard-shimmer";
function useShimmerKeyframes() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(SHIMMER_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SHIMMER_STYLE_ID;
    style.textContent =
      "@keyframes a2ui-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}";
    document.head.appendChild(style);
  }, []);
}

function ShimmerText({ props }: RendererProps<any>) {
  useShimmerKeyframes();
  const base = textColor(props.color ?? "secondary");
  return (
    <span
      style={{
        ...(props.size ? textFont(props.size) : {}),
        ...typographyStyle(props),
        display: "inline-block",
        textDecoration: props.lineThrough ? "line-through" : undefined,
        backgroundImage: `linear-gradient(90deg, ${base} 0%, ${base} 40%, var(--a2ui-color-shimmer, #d9d9d9) 50%, ${base} 60%, ${base} 100%)`,
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        animation: "a2ui-shimmer 1.5s linear infinite",
      }}
    >
      {str(props.text)}
    </span>
  );
}

/** ChatGPT badge (md): 20px pill, 12px/500 text, 0.3px tracking, ~6.65px side padding. */
const BADGE_PAD: Record<string, string> = {
  sm: "0 5px",
  md: "0 6.65px",
  lg: "2px 8px",
};
const BADGE_FONT: Record<string, string> = {
  sm: ".6875em",
  md: ".75em",
  lg: ".8125em",
};
const BADGE_HEIGHT: Record<string, number> = { sm: 18, md: 20, lg: 24 };
const BADGE_NEUTRAL_BG =
  "var(--a2ui-color-badge-secondary, rgba(0, 0, 0, 0.05))";

function Badge({ props }: RendererProps<any>) {
  const color: string = props.color ?? "secondary";
  const variant: string = props.variant ?? "soft";
  const neutral = color === "secondary";
  const solid = neutral ? "surface-inverted" : `${color}-solid`;
  const fg = neutral ? textColor("default") : textColor(color);
  const size: string = props.size ?? "md";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        boxSizing: "border-box",
        minHeight: BADGE_HEIGHT[size],
        verticalAlign: "middle",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: spacing(props.maxWidth),
        padding:
          props.padding != null ? spacing(props.padding) : BADGE_PAD[size],
        fontSize: BADGE_FONT[size],
        lineHeight: "16px",
        letterSpacing: "0.3px",
        fontWeight: FONT_WEIGHT[(props.weight as Weight) ?? "medium"],
        borderRadius: props.pill === false ? radius("sm") : radius("full"),
        background:
          variant === "solid"
            ? backgroundColor(solid)
            : variant === "outline"
              ? "transparent"
              : neutral
                ? BADGE_NEUTRAL_BG
                : backgroundColor(color),
        color: variant === "solid" ? "#fff" : fg,
        border:
          variant === "outline"
            ? `1px solid ${borderColor(color === "secondary" ? "default" : color)}`
            : undefined,
      }}
    >
      {str(props.label)}
    </span>
  );
}

/** Caption lg (the default) is 14px at a 16px base, muted. */
const CAPTION_EM: Record<string, string> = {
  sm: ".75em",
  md: ".8125em",
  lg: ".875em",
};

export const textRenderers = {
  Title: ({ props }: RendererProps<any>) => {
    useStandardStyles();
    const size: TitleSize = props.size ?? "md";
    const Tag = TITLE_TAG[size] ?? "h3";
    // Size, line height, weight and margins come from the host's heading
    // styles; only what the model asked for explicitly is inline.
    const { margin: _margin, ...style } = typographyStyle(props);
    return (
      <Tag
        data-a2ui-std=""
        data-a2ui-title={size}
        style={{
          ...style,
          fontWeight: props.weight
            ? FONT_WEIGHT[props.weight as Weight]
            : props.strong === false
              ? FONT_WEIGHT.normal
              : undefined,
        }}
      >
        {str(props.text)}
      </Tag>
    );
  },
  Text: ({ props, children }: RendererProps<any>) => {
    useStandardStyles();
    const highlight =
      props.highlight === true
        ? HIGHLIGHT.orange
        : props.highlight
          ? HIGHLIGHT[props.highlight]
          : undefined;
    const decoration = [
      props.underline ? "underline" : "",
      props.lineThrough ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <span
        data-a2ui-text=""
        data-a2ui-std=""
        style={{
          display: props.inline ? "inline" : "block",
          // In a Row, text hugs its content (never stretches to 100%).
          flex: props.inline ? undefined : "0 1 auto",
          minWidth: props.inline ? undefined : 0,
          // Without a size, text inherits the host's size and line height.
          ...(props.size ? textFont(props.size) : {}),
          ...typographyStyle(props),
          fontWeight: props.weight
            ? FONT_WEIGHT[props.weight as Weight]
            : props.strong
              ? FONT_WEIGHT.semibold
              : undefined,
          textDecoration: decoration || undefined,
          whiteSpace: props.preserveWhitespace
            ? "pre-wrap"
            : typographyStyle(props).whiteSpace,
          background: highlight,
        }}
      >
        {renderInlineMarkdown(str(props.text))}
        {props.children?.length ? (
          <>
            {props.text ? " " : null}
            {renderChildren(props.children, children)}
          </>
        ) : null}
      </span>
    );
  },
  Caption: ({ props }: RendererProps<any>) => (
    <span
      style={{
        display: "block",
        fontSize: CAPTION_EM[props.size ?? "lg"] ?? CAPTION_EM.lg,
        ...typographyStyle({ ...props, color: props.color ?? "secondary" }),
        fontWeight: FONT_WEIGHT[(props.weight as Weight) ?? "normal"],
      }}
    >
      {renderInlineMarkdown(str(props.text))}
    </span>
  ),
  Label: ({ props }: RendererProps<any>) => (
    <label
      htmlFor={props.htmlFor}
      style={{
        display: "block",
        ...textFont(props.size ?? "sm"),
        ...typographyStyle({ ...props, color: props.color ?? "secondary" }),
        fontWeight: FONT_WEIGHT[(props.weight as Weight) ?? "medium"],
      }}
    >
      {str(props.text)}
    </label>
  ),
  Bold: ({ props }: RendererProps<any>) => (
    <strong
      style={{
        fontWeight: props.weight
          ? FONT_WEIGHT[props.weight as Weight]
          : undefined,
      }}
    >
      {str(props.text)}
    </strong>
  ),
  Italic: ({ props }: RendererProps<any>) => <em>{str(props.text)}</em>,
  Underline: ({ props }: RendererProps<any>) => <u>{str(props.text)}</u>,
  Strikethrough: ({ props }: RendererProps<any>) => <s>{str(props.text)}</s>,
  Badge,
  Blockquote: ({ props }: RendererProps<any>) => (
    <blockquote
      style={{
        margin: 0,
        paddingLeft: spacing(3),
        borderLeft: `3px solid ${borderColor("strong")}`,
        color: textColor("secondary"),
      }}
    >
      {renderInlineMarkdown(str(props.text))}
    </blockquote>
  ),
  Code: ({ props }: RendererProps<any>) => (
    <pre
      style={{
        margin: 0,
        padding: spacing(3),
        borderRadius: radius("md"),
        background: backgroundColor("surface-secondary"),
        overflowX: "auto",
        fontSize: 13,
      }}
    >
      <code data-language={props.language}>{str(props.text)}</code>
    </pre>
  ),
  Markdown: ({ props }: RendererProps<any>) => (
    // No typography of its own: it reads like the chat's prose around it.
    <div className="a2ui-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => {
            const safe = safeHref(href);
            return safe ? (
              <a href={safe} target="_blank" rel="noopener noreferrer">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            );
          },
        }}
      >
        {str(props.text)}
      </ReactMarkdown>
    </div>
  ),
  Math: ({ props }: RendererProps<any>) => (
    <code
      data-math={props.block ? "block" : "inline"}
      style={{
        display: props.block ? "block" : "inline",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        textAlign: props.block ? "center" : undefined,
      }}
    >
      {str(props.value)}
    </code>
  ),
  ShimmerText,
  Link: ({ props }: RendererProps<any>) => {
    const href = safeHref(props.href);
    const label = str(props.text) || str(props.href);
    return href ? (
      <a
        href={href}
        title={props.title}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: textColor("info") }}
      >
        {label}
      </a>
    ) : (
      <span title={props.title}>{label}</span>
    );
  },
  Tooltip: ({ props, children }: RendererProps<any>) => (
    <span title={str(props.content)} style={{ display: "inline-flex" }}>
      {renderChildren(props.children, children)}
    </span>
  ),
} satisfies CatalogRenderers<typeof textDefinitions>;
