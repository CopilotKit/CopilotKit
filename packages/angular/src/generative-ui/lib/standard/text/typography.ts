import { Component, Directive, computed, inject, input } from "@angular/core";
import type { z } from "zod";
import {
  FONT_WEIGHT,
  ON_ACCENT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  BADGE_SIZES,
  CAPTION_SIZES,
  TextSize,
  TitleSize,
  Weight,
  badgeSchema,
  textSchema,
  typographySchema,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import { VISUALLY_HIDDEN, px } from "../style";
import type { StyleMap } from "../style";
import { INLINE_MARKDOWN, safeHref, tokenizeInlineMarkdown } from "./markdown";

type TypographyProps = z.output<typeof typographySchema>;
type TextProps = z.output<typeof textSchema>;
type BadgeProps = z.output<typeof badgeSchema>;
type BadgeSize = (typeof BADGE_SIZES)[number];
type CaptionSize = (typeof CAPTION_SIZES)[number];

const FOCUS_RING = "2px solid var(--a2ui-color-focus, #0285ff)";
const TEXT_STYLE_ID = "a2ui-standard-text";
const TEXT_CSS = [
  "@keyframes a2ui-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}",
  "@media (prefers-reduced-motion:reduce){[data-a2ui-shimmer]{animation:none!important}}",
  `[data-a2ui-tooltip-trigger]:focus-visible{outline:${FOCUS_RING};outline-offset:2px}`,
].join("\n");

/** Adds the shimmer keyframes and the tooltip focus ring once. */
export function ensureTextStyles(styles: GenerativeUIStyles) {
  styles.ensureStandard();
  styles.ensure(TEXT_STYLE_ID, TEXT_CSS);
}

/** The CSS of the shared typography props. */
function typographyStyle(props: TypographyProps): StyleMap {
  const clamp: StyleMap = props.truncate
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
  };
}

/** The typography inputs, shared by Title, Text and ShimmerText. */
@Directive()
abstract class Typography {
  readonly color = input<string>();
  readonly fontWeight = input<Weight>();
  readonly textAlign = input<TypographyProps["textAlign"]>();
  readonly italic = input<boolean>();
  readonly truncate = input<boolean>();
  readonly maxLines = input<number>();
  readonly tabularNums = input<boolean>();
  readonly width = input<TypographyProps["width"]>();

  protected readonly typography = computed(() =>
    typographyStyle({
      color: this.color(),
      fontWeight: this.fontWeight(),
      textAlign: this.textAlign(),
      italic: this.italic(),
      truncate: this.truncate(),
      maxLines: this.maxLines(),
      tabularNums: this.tabularNums(),
      width: this.width(),
    }),
  );
}

/**
 * The heading level of each size. The size, line height and weight come
 * from the heading styles of the host (the chat prose). `STANDARD_CSS` has
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

/**
 * A heading. The element changes with the size (h2, h3 or h4), as in React:
 * the node renderer creates the host from `hostTag`. Only what the model
 * set is inline; the rest comes from the heading styles of the host.
 */
@Component({
  selector: "[copilotGenerativeUITitle]",
  template: "",
  host: {
    "data-a2ui-std": "",
    "[attr.data-a2ui-title]": "size() ?? 'md'",
    "[style]": "style()",
    "[textContent]": "text()",
  },
})
export class CopilotGenerativeUITitle extends Typography {
  /** The heading element of the size. */
  static hostTag(props: Record<string, unknown>) {
    return TITLE_TAG[props.size as keyof typeof TITLE_TAG] ?? TITLE_TAG.md;
  }

  readonly text = input.required<string>();
  readonly size = input<TitleSize>();
  readonly strong = input<boolean>();

  protected readonly style = computed<StyleMap>(() => ({
    ...this.typography(),
    fontWeight: this.fontWeight()
      ? FONT_WEIGHT[this.fontWeight()!]
      : this.strong() === false
        ? FONT_WEIGHT.normal
        : undefined,
  }));

  constructor() {
    super();
    inject(GenerativeUIStyles).ensureStandard();
  }
}

const HIGHLIGHT = {
  green: "var(--a2ui-color-highlight-green, #d3f5e4)",
  orange: "var(--a2ui-color-highlight-orange, #ffe7c7)",
  pink: "var(--a2ui-color-highlight-pink, #fde0ef)",
};

/**
 * A span of text with inline markdown, followed by its `children` inline.
 * Without a size it takes the size and line height of the host.
 */
@Component({
  selector: "span[copilotGenerativeUIText]",
  imports: [CopilotGenerativeUIChildren],
  template:
    INLINE_MARKDOWN +
    `@if (children(); as children) {` +
    `@if (text() !== undefined && text() !== "") {<ng-container>{{ " " }}</ng-container>}` +
    `<ng-container *copilotGenerativeUIChildren="children" />` +
    `}`,
  host: {
    "data-a2ui-text": "",
    "data-a2ui-std": "",
    "[attr.aria-label]": "aria()['aria-label']",
    "[attr.aria-description]": "aria()['aria-description']",
    "[attr.aria-live]": "aria()['aria-live']",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIText extends Typography {
  readonly text = input<string | number>();
  readonly weight = input<number>();
  readonly size = input<TextSize>();
  readonly fontSize = input<TextProps["fontSize"]>();
  readonly lineHeight = input<number | string>();
  readonly minLines = input<number>();
  readonly strong = input<boolean>();
  readonly underline = input<boolean>();
  readonly lineThrough = input<boolean>();
  readonly inline = input<boolean>();
  readonly preserveWhitespace = input<boolean>();
  readonly highlight = input<TextProps["highlight"]>();
  readonly children = input<GenerativeUIChildren>();

  protected readonly aria = injectGenerativeUIAccessibility();
  protected readonly hidden = VISUALLY_HIDDEN;
  protected readonly tokens = computed(() => {
    const text = this.text();
    return tokenizeInlineMarkdown(text === undefined ? "" : String(text));
  });

  protected readonly style = computed<StyleMap>(() => {
    const highlight = this.highlight();
    const background =
      highlight === true
        ? HIGHLIGHT.orange
        : highlight
          ? HIGHLIGHT[highlight]
          : undefined;
    const decoration = [
      this.underline() ? "underline" : "",
      this.lineThrough() ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const typography = this.typography();
    const fontWeight = this.fontWeight()
      ? FONT_WEIGHT[this.fontWeight()!]
      : this.strong()
        ? FONT_WEIGHT.semibold
        : undefined;
    const inline = this.inline();
    const size = this.size();
    const fontSize = this.fontSize();
    const lineHeight = this.lineHeight();
    const minLines = this.minLines();
    return {
      display: inline ? "inline" : "block",
      // In a Row, text takes the width of its content, not 100%.
      flex: inline ? undefined : `${this.weight() ?? 0} 1 auto`,
      minWidth: inline ? undefined : 0,
      ...(size ? textFont(size) : {}),
      ...(fontSize !== undefined ? { fontSize: px(fontSize) } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
      minHeight: minLines ? `${minLines * 1.5}em` : undefined,
      margin: 0,
      ...typography,
      fontWeight,
      textDecoration: decoration || undefined,
      whiteSpace: this.preserveWhitespace()
        ? "pre-wrap"
        : typography.whiteSpace,
      background,
    };
  });

  constructor() {
    super();
    inject(GenerativeUIStyles).ensureStandard();
  }
}

/** Caption "lg" (the default) is 14px at a 16px base. */
const CAPTION_EM: Record<CaptionSize, string> = {
  sm: ".75em",
  md: ".8125em",
  lg: ".875em",
};

/** Small secondary text with inline markdown, sized in em. */
@Component({
  selector: "span[copilotGenerativeUICaption]",
  template: INLINE_MARKDOWN,
  host: { "[style]": "style()" },
})
export class CopilotGenerativeUICaption {
  readonly text = input.required<string | number>();
  readonly color = input<string>();
  readonly size = input<CaptionSize>();
  readonly fontWeight = input<Weight>();
  readonly textAlign = input<TypographyProps["textAlign"]>();
  readonly truncate = input<boolean>();
  readonly maxLines = input<number>();

  protected readonly hidden = VISUALLY_HIDDEN;
  protected readonly tokens = computed(() =>
    tokenizeInlineMarkdown(String(this.text())),
  );
  protected readonly style = computed<StyleMap>(() => ({
    display: "block",
    fontSize: CAPTION_EM[this.size() ?? "lg"],
    margin: 0,
    ...typographyStyle({
      color: this.color() ?? "secondary",
      textAlign: this.textAlign(),
      truncate: this.truncate(),
      maxLines: this.maxLines(),
    }),
    fontWeight: FONT_WEIGHT[this.fontWeight() ?? "normal"],
  }));
}

/** A `<label>`, tied to a control with `htmlFor`. */
@Component({
  selector: "label[copilotGenerativeUILabel]",
  template: "",
  host: {
    "[attr.for]": "htmlFor()",
    "[style]": "style()",
    "[textContent]": "text()",
  },
})
export class CopilotGenerativeUILabel {
  readonly text = input.required<string | number>();
  readonly htmlFor = input<string>();
  readonly color = input<string>();
  readonly size = input<TextSize>();
  readonly fontWeight = input<Weight>();
  readonly textAlign = input<TypographyProps["textAlign"]>();
  readonly truncate = input<boolean>();
  readonly width = input<TypographyProps["width"]>();

  protected readonly style = computed<StyleMap>(() => ({
    display: "block",
    ...textFont(this.size() ?? "sm"),
    margin: 0,
    ...typographyStyle({
      color: this.color() ?? "secondary",
      textAlign: this.textAlign(),
      truncate: this.truncate(),
      width: this.width(),
    }),
    fontWeight: FONT_WEIGHT[this.fontWeight() ?? "medium"],
  }));
}

/** A `<strong>`, with an optional weight. */
@Component({
  selector: "strong[copilotGenerativeUIBold]",
  template: "",
  host: { "[style.font-weight]": "weight()", "[textContent]": "text()" },
})
export class CopilotGenerativeUIBold {
  readonly text = input.required<string>();
  readonly fontWeight = input<Weight>();
  protected readonly weight = computed(() => {
    const weight = this.fontWeight();
    return weight ? FONT_WEIGHT[weight] : null;
  });
}

/** An `<em>`. */
@Component({
  selector: "em[copilotGenerativeUIItalic]",
  template: "",
  host: { "[textContent]": "text()" },
})
export class CopilotGenerativeUIItalic {
  readonly text = input.required<string>();
}

/** A `<u>`. */
@Component({
  selector: "u[copilotGenerativeUIUnderline]",
  template: "",
  host: { "[textContent]": "text()" },
})
export class CopilotGenerativeUIUnderline {
  readonly text = input.required<string>();
}

/** An `<s>`. */
@Component({
  selector: "s[copilotGenerativeUIStrikethrough]",
  template: "",
  host: { "[textContent]": "text()" },
})
export class CopilotGenerativeUIStrikethrough {
  readonly text = input.required<string>();
}

/** A `<blockquote>` with inline markdown and a rule on the left. */
@Component({
  selector: "blockquote[copilotGenerativeUIBlockquote]",
  template: INLINE_MARKDOWN,
  host: { "data-a2ui-std": "", "[style]": "style" },
})
export class CopilotGenerativeUIBlockquote {
  readonly text = input.required<string>();
  protected readonly hidden = VISUALLY_HIDDEN;
  protected readonly tokens = computed(() =>
    tokenizeInlineMarkdown(this.text()),
  );
  protected readonly style: StyleMap = {
    margin: 0,
    paddingLeft: spacing(3),
    borderLeft: `3px solid ${borderColor("strong")}`,
    color: textColor("secondary"),
  };

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}

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

/** A small label: soft, solid or outlined, a pill unless `pill` is false. */
@Component({
  selector: "span[copilotGenerativeUIBadge]",
  template: "",
  host: { "[style]": "style()", "[textContent]": "label()" },
})
export class CopilotGenerativeUIBadge {
  readonly label = input.required<string>();
  readonly color = input<BadgeProps["color"]>();
  readonly size = input<BadgeSize>();
  readonly pill = input<boolean>();
  readonly variant = input<BadgeProps["variant"]>();
  readonly fontWeight = input<Weight>();
  readonly maxWidth = input<BadgeProps["maxWidth"]>();
  readonly padding = input<BadgeProps["padding"]>();

  protected readonly style = computed<StyleMap>(() => {
    const color = this.color() ?? "secondary";
    const variant = this.variant() ?? "soft";
    const size = this.size() ?? "md";
    const isNeutral = color === "secondary";
    const ink = textColor(isNeutral ? "default" : color);
    const padding = this.padding();
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      flexShrink: 0,
      boxSizing: "border-box",
      minHeight: `${BADGE_HEIGHT[size]}px`,
      verticalAlign: "middle",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      maxWidth: spacing(this.maxWidth()),
      padding: padding !== undefined ? spacing(padding) : BADGE_PAD[size],
      fontSize: BADGE_FONT[size],
      lineHeight: "16px",
      letterSpacing: "0.3px",
      fontWeight: FONT_WEIGHT[this.fontWeight() ?? "medium"],
      borderRadius: this.pill() === false ? radius("sm") : radius("full"),
      background: badgeBackground(color, variant),
      color: variant === "solid" ? ON_ACCENT : ink,
      border:
        variant === "outline"
          ? `1px solid ${borderColor(isNeutral ? "default" : color)}`
          : undefined,
    };
  });
}

/** A block of code. The block scrolls sideways, so a keyboard user can focus it. */
@Component({
  selector: "pre[copilotGenerativeUICode]",
  template: `
    <code [attr.data-language]="language()" [textContent]="text()"></code>
  `,
  host: { tabindex: "0", "data-a2ui-scroll": "", "[style]": "style" },
})
export class CopilotGenerativeUICode {
  readonly text = input.required<string>();
  readonly language = input<string>();
  protected readonly style: StyleMap = {
    margin: 0,
    padding: spacing(3),
    borderRadius: radius("md"),
    background: backgroundColor("surface-secondary"),
    overflowX: "auto",
    fontSize: ".8125em",
  };

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}

/** Text with a moving shimmer. The shimmer stops for reduced motion. */
@Component({
  selector: "span[copilotGenerativeUIShimmerText]",
  template: "",
  host: {
    "data-a2ui-shimmer": "",
    "[style]": "style()",
    "[textContent]": "text()",
  },
})
export class CopilotGenerativeUIShimmerText extends Typography {
  readonly text = input.required<string>();
  readonly size = input<TextSize>();
  readonly lineThrough = input<boolean>();

  protected readonly style = computed<StyleMap>(() => {
    const base = textColor(this.color() ?? "secondary");
    const size = this.size();
    return {
      ...(size ? textFont(size) : {}),
      margin: 0,
      ...this.typography(),
      display: "inline-block",
      textDecoration: this.lineThrough() ? "line-through" : undefined,
      backgroundImage: `linear-gradient(90deg, ${base} 0%, ${base} 40%, var(--a2ui-color-shimmer, #d9d9d9) 50%, ${base} 60%, ${base} 100%)`,
      backgroundSize: "200% 100%",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      animation: "a2ui-shimmer 1.5s linear infinite",
    };
  });

  constructor() {
    super();
    ensureTextStyles(inject(GenerativeUIStyles));
  }
}

/**
 * A link that opens in a new tab; screen readers also hear that. With an
 * unsafe URL (not http, https or mailto) the anchor has no `href`, so it is
 * plain text with no link role.
 */
@Component({
  selector: "a[copilotGenerativeUILink]",
  template: `
    <span [textContent]="label()"></span>
    @if (safe()) {
      <span [style]="hidden" [textContent]="note"></span>
    }
  `,
  host: {
    "[attr.href]": "safe()",
    "[attr.target]": "safe() ? '_blank' : null",
    "[attr.rel]": "safe() ? 'noopener noreferrer' : null",
    "[attr.title]": "title()",
    "[style.color]": "safe() ? color : null",
  },
})
export class CopilotGenerativeUILink {
  readonly text = input.required<string>();
  readonly href = input.required<string>();
  readonly title = input<string>();

  protected readonly hidden = VISUALLY_HIDDEN;
  protected readonly note = " (opens in a new tab)";
  protected readonly color = textColor("info");
  protected readonly safe = computed(() => safeHref(this.href()));
  protected readonly label = computed(() => this.text() || this.href());
}
