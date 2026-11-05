import React, { useEffect, useId, useMemo, useState } from "react";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import { renderToString } from "katex";
import type { z } from "zod";
import { useKatexStyles } from "../../hooks/useKatexStyles";
import {
  ExternalLink,
  Markdown,
  renderInlineMarkdown,
  safeHref,
} from "./markdown";
import { useGenerativeUIAccessibility } from "../accessibility";
import { useStandardStyles } from "./styles";
import {
  FONT_WEIGHT,
  ON_ACCENT,
  SHADOW_MD,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textDeclarations,
  textFont,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import type {
  BADGE_SIZES,
  CAPTION_SIZES,
  TitleSize,
  badgeSchema,
  blockquoteSchema,
  boldSchema,
  captionSchema,
  codeSchema,
  inlineTextSchema,
  labelSchema,
  linkSchema,
  mathSchema,
  shimmerSchema,
  textSchema,
  titleSchema,
  typographySchema,
} from "@copilotkit/shared/generative-ui";

type TypographyProps = z.output<typeof typographySchema>;
type TextProps = z.output<typeof textSchema> & { children?: ReactNode };
type BadgeProps = z.output<typeof badgeSchema>;
type BadgeSize = (typeof BADGE_SIZES)[number];
type CaptionSize = (typeof CAPTION_SIZES)[number];

// ---- Styles ----

const FOCUS_RING = "2px solid var(--a2ui-color-focus, #0285ff)";
const TEXT_STYLE_ID = "a2ui-standard-text";
const TEXT_CSS = [
  "@keyframes a2ui-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}",
  "@media (prefers-reduced-motion:reduce){[data-a2ui-shimmer]{animation:none!important}}",
  `[data-a2ui-tooltip-trigger]:focus-visible{outline:${FOCUS_RING};outline-offset:2px}`,
].join("\n");

/** Adds the shimmer keyframes and the tooltip focus ring once. */
function useTextStyles() {
  useEffect(() => {
    if (document.getElementById(TEXT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = TEXT_STYLE_ID;
    style.textContent = TEXT_CSS;
    document.head.appendChild(style);
  }, []);
}

/** The CSS of the shared typography props. */
function typographyStyle(props: TypographyProps) {
  const clamp: CSSProperties = props.truncate
    ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
    : props.maxLines
      ? {
          display: "-webkit-box",
          WebkitLineClamp: props.maxLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }
      : {};
  return {
    color: textColor(props.color),
    fontWeight: props.fontWeight ? FONT_WEIGHT[props.fontWeight] : undefined,
    textAlign: props.textAlign,
    fontStyle: props.italic ? "italic" : undefined,
    fontVariantNumeric: props.tabularNums ? "tabular-nums" : undefined,
    width: spacing(props.width),
    ...clamp,
  } satisfies CSSProperties;
}

// ---- Title ----

/**
 * The heading level of each size. The size, line height and weight come
 * from the heading styles of the host (the chat prose). `styles.ts` has
 * fallbacks for hosts without heading styles.
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

function Title(props: z.output<typeof titleSchema>) {
  useStandardStyles();
  const size = props.size ?? "md";
  const Tag = TITLE_TAG[size];
  // Only what the model set is inline. The rest comes from the host.
  const fontWeight = props.fontWeight
    ? FONT_WEIGHT[props.fontWeight]
    : props.strong === false
      ? FONT_WEIGHT.normal
      : undefined;
  return (
    <Tag
      data-a2ui-std=""
      data-a2ui-title={size}
      style={{ ...typographyStyle(props), fontWeight }}
    >
      {props.text}
    </Tag>
  );
}

// ---- Text ----

const HIGHLIGHT = {
  green: "var(--a2ui-color-highlight-green, #d3f5e4)",
  orange: "var(--a2ui-color-highlight-orange, #ffe7c7)",
  pink: "var(--a2ui-color-highlight-pink, #fde0ef)",
};

function Text(props: TextProps) {
  useStandardStyles();
  const aria = useGenerativeUIAccessibility();
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
  const typography = typographyStyle(props);
  const fontWeight = props.fontWeight
    ? FONT_WEIGHT[props.fontWeight]
    : props.strong
      ? FONT_WEIGHT.semibold
      : undefined;
  const hasChildren = React.Children.count(props.children) > 0;
  return (
    <span
      data-a2ui-text=""
      data-a2ui-std=""
      {...aria}
      style={{
        display: props.inline ? "inline" : "block",
        // In a Row, text takes the width of its content, not 100%.
        flex: props.inline ? undefined : `${props.weight ?? 0} 1 auto`,
        minWidth: props.inline ? undefined : 0,
        // Without a size, text takes the size and line height of the host.
        ...(props.size ? textFont(props.size) : {}),
        ...(props.fontSize !== undefined
          ? { fontSize: px(props.fontSize) }
          : {}),
        ...(props.lineHeight !== undefined
          ? { lineHeight: props.lineHeight }
          : {}),
        minHeight: props.minLines ? `${props.minLines * 1.5}em` : undefined,
        margin: 0,
        ...typography,
        fontWeight,
        textDecoration: decoration || undefined,
        whiteSpace: props.preserveWhitespace
          ? "pre-wrap"
          : typography.whiteSpace,
        background: highlight,
      }}
    >
      {renderInlineMarkdown(props.text === undefined ? "" : String(props.text))}
      {hasChildren ? (
        <>
          {props.text ? " " : null}
          {props.children}
        </>
      ) : null}
    </span>
  );
}

// ---- Caption, Label, Bold ----

/** Caption "lg" (the default) is 14px at a 16px base. */
const CAPTION_EM: Record<CaptionSize, string> = {
  sm: ".75em",
  md: ".8125em",
  lg: ".875em",
};

function Caption(props: z.output<typeof captionSchema>) {
  return (
    <span
      style={{
        display: "block",
        fontSize: CAPTION_EM[props.size ?? "lg"],
        margin: 0,
        ...typographyStyle({ ...props, color: props.color ?? "secondary" }),
        fontWeight: FONT_WEIGHT[props.fontWeight ?? "normal"],
      }}
    >
      {renderInlineMarkdown(String(props.text))}
    </span>
  );
}

function Label(props: z.output<typeof labelSchema>) {
  return (
    <label
      htmlFor={props.htmlFor}
      style={{
        display: "block",
        ...textFont(props.size ?? "sm"),
        margin: 0,
        ...typographyStyle({ ...props, color: props.color ?? "secondary" }),
        fontWeight: FONT_WEIGHT[props.fontWeight ?? "medium"],
      }}
    >
      {props.text}
    </label>
  );
}

/** Pixels when a number, raw CSS when a string. */
function px(value: number | string) {
  return typeof value === "number" ? `${value}px` : value;
}

function Italic(props: z.output<typeof inlineTextSchema>) {
  return <em>{props.text}</em>;
}

function Underline(props: z.output<typeof inlineTextSchema>) {
  return <u>{props.text}</u>;
}

function Strikethrough(props: z.output<typeof inlineTextSchema>) {
  return <s>{props.text}</s>;
}

function Blockquote(props: z.output<typeof blockquoteSchema>) {
  useStandardStyles();
  return (
    <blockquote
      data-a2ui-std=""
      style={{
        margin: 0,
        paddingLeft: spacing(3),
        borderLeft: `3px solid ${borderColor("strong")}`,
        color: textColor("secondary"),
      }}
    >
      {renderInlineMarkdown(props.text)}
    </blockquote>
  );
}

function Bold(props: z.output<typeof boldSchema>) {
  return (
    <strong
      style={{
        fontWeight: props.fontWeight
          ? FONT_WEIGHT[props.fontWeight]
          : undefined,
      }}
    >
      {props.text}
    </strong>
  );
}

// ---- Badge ----

/** Badge "md": a 20px pill, 12px text with weight 500 and 0.3px tracking. */
const BADGE_PAD: Record<BadgeSize, string> = {
  sm: "0 5px",
  md: "0 6.65px",
  lg: "2px 8px",
};
const BADGE_FONT: Record<BadgeSize, string> = {
  sm: ".6875em",
  md: ".75em",
  lg: ".8125em",
};
const BADGE_HEIGHT: Record<BadgeSize, number> = { sm: 18, md: 20, lg: 24 };
const BADGE_NEUTRAL_BG =
  "var(--a2ui-color-badge-secondary, rgba(0, 0, 0, 0.05))";

/** The fill of a badge: solid, none (outline), or a soft tint. */
function badgeBackground(color: string, variant: string) {
  const isNeutral = color === "secondary";
  switch (variant) {
    case "solid":
      return backgroundColor(isNeutral ? "surface-inverted" : `${color}-solid`);
    case "outline":
      return "transparent";
    default:
      return isNeutral ? BADGE_NEUTRAL_BG : backgroundColor(color);
  }
}

function Badge(props: BadgeProps) {
  const color = props.color ?? "secondary";
  const variant = props.variant ?? "soft";
  const size = props.size ?? "md";
  const isNeutral = color === "secondary";
  const ink = textColor(isNeutral ? "default" : color);
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
          props.padding !== undefined
            ? spacing(props.padding)
            : BADGE_PAD[size],
        fontSize: BADGE_FONT[size],
        lineHeight: "16px",
        letterSpacing: "0.3px",
        fontWeight: FONT_WEIGHT[props.fontWeight ?? "medium"],
        borderRadius: props.pill === false ? radius("sm") : radius("full"),
        background: badgeBackground(color, variant),
        color: variant === "solid" ? ON_ACCENT : ink,
        border:
          variant === "outline"
            ? `1px solid ${borderColor(isNeutral ? "default" : color)}`
            : undefined,
      }}
    >
      {props.label}
    </span>
  );
}

// ---- Code, Math ----

function Code(props: z.output<typeof codeSchema>) {
  useStandardStyles();
  return (
    // The block scrolls sideways, so a keyboard user must be able to focus it.
    <pre
      tabIndex={0}
      data-a2ui-scroll=""
      style={{
        margin: 0,
        padding: spacing(3),
        borderRadius: radius("md"),
        background: backgroundColor("surface-secondary"),
        overflowX: "auto",
        fontSize: ".8125em",
      }}
    >
      <code data-language={props.language}>{props.text}</code>
    </pre>
  );
}

function MathFormula(props: z.output<typeof mathSchema>) {
  useKatexStyles();
  const isBlock = props.block === true;
  // KaTeX escapes the source and adds MathML for screen readers. With
  // `trust: false`, commands that make links or raw HTML do not work. An
  // invalid formula shows as red source text, not as an error.
  const html = useMemo(
    () =>
      renderToString(props.value, {
        displayMode: isBlock,
        throwOnError: false,
        trust: false,
      }),
    [props.value, isBlock],
  );
  const Tag = isBlock ? "div" : "span";
  return (
    <Tag
      data-math={isBlock ? "block" : "inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ---- ShimmerText ----

function ShimmerText(props: z.output<typeof shimmerSchema>) {
  useTextStyles();
  const base = textColor(props.color ?? "secondary");
  return (
    <span
      data-a2ui-shimmer=""
      style={{
        ...(props.size ? textFont(props.size) : {}),
        margin: 0,
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
      {props.text}
    </span>
  );
}

// ---- Link ----

function Link(props: z.output<typeof linkSchema>) {
  const href = safeHref(props.href);
  const label = props.text || props.href;
  if (!href) return <span title={props.title}>{label}</span>;
  return (
    <ExternalLink
      href={href}
      title={props.title}
      style={{ color: textColor("info") }}
    >
      {label}
    </ExternalLink>
  );
}

// ---- Tooltip ----

interface TooltipProps {
  trigger?: ReactNode;
  content?: ReactNode;
}

/**
 * Shows `content` while the pointer is over `trigger` or while `trigger`
 * has keyboard focus. Escape hides it. The trigger can take focus, and
 * screen readers read the content as its description.
 */
function Tooltip({ trigger, content }: TooltipProps) {
  useTextStyles();
  const id = useId();
  const [isOpen, setOpen] = useState(false);
  const close = () => setOpen(false);
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    const isFocusInside = event.currentTarget.contains(event.relatedTarget);
    if (!isFocusInside) close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Escape") close();
  };
  return (
    <span
      // The wrapper hugs the trigger, so the tip centers on the trigger and
      // not on a stretched flex item.
      style={{
        position: "relative",
        display: "inline-flex",
        alignSelf: "flex-start",
        width: "max-content",
        maxWidth: "100%",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
    >
      <span
        tabIndex={0}
        data-a2ui-tooltip-trigger=""
        aria-describedby={id}
        style={{ display: "inline-flex" }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {trigger}
      </span>
      {/* The padding keeps the tooltip open while the pointer moves onto it. */}
      <span
        role="tooltip"
        id={id}
        hidden={!isOpen}
        style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          paddingBottom: 6,
          zIndex: 10,
        }}
      >
        <span
          style={{
            display: "block",
            width: "max-content",
            maxWidth: 240,
            padding: "4px 8px",
            borderRadius: radius("sm"),
            background: backgroundColor("surface-inverted"),
            color: ON_ACCENT,
            boxShadow: SHADOW_MD,
            ...textFont("xs"),
          }}
        >
          {content}
        </span>
      </span>
    </span>
  );
}

/**
 * The standard text components. Give them to
 * `createGenerativeUI({ components: { ...textComponents } })`.
 *
 * - Text has a "multiple" `children` slot. The children render inline
 *   after the text.
 * - Tooltip has two "single" slots: `trigger` and `content`.
 * - Link is a plain link. It opens http, https and mailto URLs only.
 */
export const textComponents = withComponents(textDeclarations, {
  Title,
  Text,
  Caption,
  Label,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Badge,
  Blockquote,
  Code,
  Markdown,
  Math: MathFormula,
  ShimmerText,
  Link,
  Tooltip,
});
