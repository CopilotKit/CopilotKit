"use client";

import { Children } from "react";
import type { CSSProperties } from "react";
import {
  Badge as KumoBadge,
  Label as KumoLabel,
  Link as KumoLink,
  Loader,
  Text as KumoText,
  Tooltip as KumoTooltip,
} from "@cloudflare/kumo";
import { CodeHighlighted, normalizeLanguage } from "@cloudflare/kumo/code";
import type { BundledLanguage } from "@cloudflare/kumo/code";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import {
  VISUALLY_HIDDEN,
  renderInlineMarkdown,
  safeHref,
} from "./inline-markdown";
import { defined, sizeOf, textColorOf } from "./style";
import type { StandardProps } from "./types";

type KumoCopyVariant = "body" | "secondary" | "error";
type KumoTextSize = "xs" | "sm" | "base" | "lg";

const FONT_WEIGHT = { normal: 400, medium: 500, semibold: 600, bold: 700 };

/** The shared typography props of the standard text components. */
interface TypographyProps {
  color?: string;
  fontWeight?: keyof typeof FONT_WEIGHT;
  textAlign?: "start" | "center" | "end";
  italic?: boolean;
  truncate?: boolean;
  maxLines?: number;
  tabularNums?: boolean;
  width?: number | string;
}

/** The CSS of the typography props that Kumo Text has no prop for. */
function typographyStyle(props: TypographyProps): CSSProperties {
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
  return defined({
    fontWeight: props.fontWeight ? FONT_WEIGHT[props.fontWeight] : undefined,
    textAlign: props.textAlign,
    fontStyle: props.italic ? "italic" : undefined,
    fontVariantNumeric: props.tabularNums ? "tabular-nums" : undefined,
    width: sizeOf(props.width),
    ...clamp,
  });
}

// ---- Title ----

type TitleSize = NonNullable<StandardProps<"Title">["size"]>;

/** The heading tag of each size, as the standard Title uses it. */
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

/**
 * The Kumo heading of a Title size. Kumo "heading" is 16px, or 20px with
 * size "lg". Kumo's only larger headings are the 24px "heading2" and the
 * 30px "heading1".
 */
export function titleVariantOf(
  size: TitleSize = "md",
):
  | { variant: "heading"; size?: "lg" }
  | { variant: "heading1" }
  | { variant: "heading2" } {
  if (size === "lg" || size === "xl") return { variant: "heading", size: "lg" };
  if (size === "2xl") return { variant: "heading2" };
  if (size === "3xl" || size === "4xl" || size === "5xl")
    return { variant: "heading1" };
  return { variant: "heading" };
}

/** Title: a Kumo heading. */
export function Title(props: StandardProps<"Title">) {
  const size = props.size ?? "md";
  const heading = titleVariantOf(size);
  const common = {
    as: TITLE_TAG[size],
    DANGEROUS_style: {
      ...typographyStyle(props),
      ...defined({
        color: textColorOf(props.color),
        fontWeight:
          props.strong === false && !props.fontWeight
            ? FONT_WEIGHT.normal
            : undefined,
      }),
    },
    children: props.text,
  };
  if (heading.variant === "heading1")
    return <KumoText variant="heading1" {...common} />;
  if (heading.variant === "heading2")
    return <KumoText variant="heading2" {...common} />;
  return <KumoText variant="heading" size={heading.size} {...common} />;
}

// ---- Text ----

type TextColor = StandardProps<"Text">["color"];

/**
 * The Kumo Text variant of a text color. Kumo's "success" variant is the
 * link blue, so success, like the other semantic colors, is "body" with
 * the color inline.
 */
export function textVariantOf(color: TextColor): KumoCopyVariant {
  if (color === "secondary" || color === "tertiary") return "secondary";
  if (color === "danger") return "error";
  return "body";
}

/** The Kumo Text size of a standard text size. */
export function textSizeOf(
  size: StandardProps<"Text">["size"],
): KumoTextSize | undefined {
  switch (size) {
    case undefined:
      return undefined;
    case "3xs":
    case "2xs":
    case "xs":
      return "xs";
    case "sm":
      return "sm";
    case "md":
      return "base";
    case "lg":
      return "lg";
  }
}

/** The inline color a Kumo Text variant does not draw itself. */
function inlineColorOf(color: TextColor) {
  if (!color || color === "default" || color === "prose") return undefined;
  if (color === "secondary" || color === "danger") return undefined;
  return textColorOf(color);
}

const HIGHLIGHT = {
  green: "var(--a2ui-color-highlight-green)",
  orange: "var(--a2ui-color-highlight-orange)",
  pink: "var(--a2ui-color-highlight-pink)",
};

/** Text: Kumo Text with the inline markdown of the standard Text. */
export function Text(props: StandardProps<"Text">) {
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
  const hasChildren = Children.count(props.children) > 0;
  return (
    <KumoText
      {...aria}
      as="span"
      variant={textVariantOf(props.color)}
      size={textSizeOf(props.size)}
      DANGEROUS_style={defined({
        display: props.inline ? "inline" : "block",
        flex: props.inline ? undefined : `${props.weight ?? 0} 1 auto`,
        minWidth: props.inline ? undefined : 0,
        ...typography,
        // Without a size, the text keeps the size of the text around it.
        fontSize:
          props.fontSize !== undefined
            ? typeof props.fontSize === "number"
              ? `${props.fontSize}px`
              : props.fontSize
            : props.size === undefined
              ? "inherit"
              : undefined,
        lineHeight: props.lineHeight,
        minHeight: props.minLines ? `${props.minLines * 1.5}em` : undefined,
        color: inlineColorOf(props.color),
        fontWeight,
        textDecoration: decoration || undefined,
        whiteSpace: props.preserveWhitespace
          ? "pre-wrap"
          : typography.whiteSpace,
        background: highlight,
      })}
    >
      {renderInlineMarkdown(props.text === undefined ? "" : String(props.text))}
      {hasChildren ? (
        <>
          {props.text ? " " : null}
          {props.children}
        </>
      ) : null}
    </KumoText>
  );
}

// ---- Caption, Label ----

const CAPTION_SIZE = { sm: "xs", md: "xs", lg: "sm" } as const;

/** Caption: secondary Kumo Text. */
export function Caption(props: StandardProps<"Caption">) {
  const color = props.color ?? "secondary";
  return (
    <KumoText
      as="span"
      variant={textVariantOf(color)}
      size={CAPTION_SIZE[props.size ?? "lg"]}
      DANGEROUS_style={{
        display: "block",
        ...typographyStyle({ ...props, color }),
        ...defined({
          color: inlineColorOf(color),
          fontWeight: FONT_WEIGHT[props.fontWeight ?? "normal"],
        }),
      }}
    >
      {renderInlineMarkdown(String(props.text))}
    </KumoText>
  );
}

/** Label: a Kumo Label. */
export function Label(props: StandardProps<"Label">) {
  const label = (
    <KumoLabel htmlFor={props.htmlFor}>{String(props.text)}</KumoLabel>
  );
  if (props.width === undefined && props.textAlign === undefined) return label;
  return (
    <div
      style={defined({
        width: sizeOf(props.width),
        textAlign: props.textAlign,
      })}
    >
      {label}
    </div>
  );
}

// ---- Inline runs ----

/** An inline run keeps the size and color of the text around it. */
const INLINE: CSSProperties = {
  fontSize: "inherit",
  lineHeight: "inherit",
  color: "inherit",
};

/** Bold: inline Kumo Text. */
export function Bold(props: StandardProps<"Bold">) {
  return (
    <KumoText
      as="strong"
      DANGEROUS_style={{
        ...INLINE,
        fontWeight: FONT_WEIGHT[props.fontWeight ?? "semibold"],
      }}
    >
      {props.text}
    </KumoText>
  );
}

/** Italic: inline Kumo Text. */
export function Italic(props: StandardProps<"Italic">) {
  return (
    <KumoText as="em" DANGEROUS_style={{ ...INLINE, fontStyle: "italic" }}>
      {props.text}
    </KumoText>
  );
}

/** Underline: inline Kumo Text, underlined. */
export function Underline(props: StandardProps<"Underline">) {
  return (
    <KumoText
      as="span"
      DANGEROUS_style={{ ...INLINE, textDecoration: "underline" }}
    >
      {props.text}
    </KumoText>
  );
}

/** Strikethrough: inline Kumo Text, struck through. */
export function Strikethrough(props: StandardProps<"Strikethrough">) {
  return (
    <KumoText
      as="span"
      DANGEROUS_style={{ ...INLINE, textDecoration: "line-through" }}
    >
      {props.text}
    </KumoText>
  );
}

// ---- Badge ----

type BadgeColor = NonNullable<StandardProps<"Badge">["color"]>;
type BadgeVariant = NonNullable<StandardProps<"Badge">["variant"]>;
type KumoBadgeVariant =
  | "secondary"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "purple"
  | "neutral"
  | "green"
  | "red"
  | "orange"
  | "blue"
  | "outline";

const SOFT_BADGE: Record<BadgeColor, KumoBadgeVariant> = {
  secondary: "secondary",
  success: "success",
  danger: "error",
  warning: "warning",
  info: "info",
  // Kumo has no soft purple.
  discovery: "purple",
};
const SOLID_BADGE: Record<BadgeColor, KumoBadgeVariant> = {
  secondary: "neutral",
  success: "green",
  danger: "red",
  warning: "orange",
  info: "blue",
  discovery: "purple",
};

/** The Kumo Badge variant of a standard badge color and variant. */
export function badgeVariantOf(
  color: BadgeColor | undefined,
  variant: BadgeVariant | undefined,
): KumoBadgeVariant {
  if (variant === "outline") return "outline";
  const table = variant === "solid" ? SOLID_BADGE : SOFT_BADGE;
  return table[color ?? "secondary"];
}

/** Badge: a Kumo Badge. */
export function Badge(props: StandardProps<"Badge">) {
  return (
    <KumoBadge variant={badgeVariantOf(props.color, props.variant)}>
      {props.label}
    </KumoBadge>
  );
}

// ---- Blockquote, ShimmerText ----

/**
 * Blockquote: secondary Kumo Text behind a line in Kumo's line color.
 * Kumo has no quote style.
 */
export function Blockquote(props: StandardProps<"Blockquote">) {
  return (
    <blockquote
      style={{
        margin: 0,
        paddingLeft: "12px",
        borderLeft: "3px solid var(--color-kumo-line)",
      }}
    >
      <KumoText
        variant="secondary"
        as="span"
        DANGEROUS_style={{ display: "block" }}
      >
        {renderInlineMarkdown(props.text)}
      </KumoText>
    </blockquote>
  );
}

/**
 * ShimmerText: Kumo's Loader next to secondary Kumo Text. A spinner is how
 * Kumo shows work in progress; it has no shimmer.
 */
export function ShimmerText(props: StandardProps<"ShimmerText">) {
  const color = props.color ?? "secondary";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        maxWidth: "100%",
      }}
    >
      <Loader size="sm" />
      <KumoText
        as="span"
        variant={textVariantOf(color)}
        size={textSizeOf(props.size)}
        DANGEROUS_style={defined({
          ...typographyStyle(props),
          color: inlineColorOf(color),
          textDecoration: props.lineThrough ? "line-through" : undefined,
        })}
      >
        {props.text}
      </KumoText>
    </span>
  );
}

// ---- Code ----

/** The languages the Shiki provider of the Kumo pages loads. */
export const SHIKI_LANGUAGES: BundledLanguage[] = [
  "tsx",
  "typescript",
  "javascript",
  "jsx",
  "json",
  "html",
  "css",
  "python",
  "bash",
  "shell",
  "sql",
  "yaml",
  "markdown",
  "graphql",
  "diff",
  "toml",
];

/**
 * Code: Kumo's Shiki code block. A language Shiki does not know shows as
 * plain text.
 */
export function Code(props: StandardProps<"Code">) {
  const language = props.language
    ? (normalizeLanguage(props.language) ?? props.language)
    : "text";
  return <CodeHighlighted code={props.text} lang={language} showCopyButton />;
}

// ---- Link ----

/** Link: a Kumo Link. Only http, https and mailto URLs are links. */
export function Link(props: StandardProps<"Link">) {
  const href = safeHref(props.href);
  const label = props.text || props.href;
  if (!href) return <span title={props.title}>{label}</span>;
  const isWeb = /^https?:/i.test(href);
  return (
    <KumoLink
      href={href}
      title={props.title}
      variant="inline"
      {...(isWeb ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {label}
      {isWeb ? (
        <>
          <KumoLink.ExternalIcon />
          <span style={VISUALLY_HIDDEN}> (opens in a new tab)</span>
        </>
      ) : null}
    </KumoLink>
  );
}

// ---- Tooltip ----

/**
 * Tooltip: a Kumo Tooltip. The trigger is a focusable span, so a Button
 * in the trigger is not nested in the button that Kumo renders by default.
 */
export function Tooltip(props: StandardProps<"Tooltip">) {
  return (
    <KumoTooltip
      content={props.content}
      render={<span tabIndex={0} style={{ display: "inline-flex" }} />}
    >
      {props.trigger}
    </KumoTooltip>
  );
}

export const textOverrides = {
  Title: { component: Title },
  Text: { component: Text },
  Caption: { component: Caption },
  Label: { component: Label },
  Bold: { component: Bold },
  Italic: { component: Italic },
  Underline: { component: Underline },
  Strikethrough: { component: Strikethrough },
  Badge: { component: Badge },
  Blockquote: { component: Blockquote },
  ShimmerText: { component: ShimmerText },
  Code: { component: Code },
  Link: { component: Link },
  Tooltip: { component: Tooltip },
};
