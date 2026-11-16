import { Component, Directive, computed, inject, input } from "@angular/core";
import { namedRole } from "@copilotkit/core/generative-ui";
import {
  INNER_PANEL_BG,
  SHADOW_MD,
  SHADOW_SM,
  SHADOW_SOFT,
  backgroundColor,
  borderColor,
  panelBackground,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type {
  LayoutProps,
  boxSchema,
  cardSchema,
  dividerSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import {
  GENERATIVE_UI_CARD_DISTANCE,
  GENERATIVE_UI_CARD_NESTING,
  provideContainerContext,
} from "../context";
import type { GenerativeUIEventProp } from "../context";
import { defined, layoutStyle } from "../style";
import type { StyleMap } from "../style";
import { connectVisibleOnce } from "../visible-once";

type CardProps = z.output<typeof cardSchema>;

export const hasGap = (props: LayoutProps) =>
  props.gap !== undefined ||
  props.columnGap !== undefined ||
  props.rowGap !== undefined ||
  props.disableAutoSpacing === true;

/** 16px between the groups directly inside a Card, 8px in a group. */
function defaultGap(distance: number | null) {
  return spacing(distance === null || distance === 0 ? 4 : 2);
}

/** The inner panel: 12px padding, 8px radius, no border, no shadow. */
function innerPanelStyle(props: LayoutProps): StyleMap {
  return {
    padding: spacing(props.padding ?? 3),
    borderRadius: radius("md"),
    background: panelBackground(props.background) ?? INNER_PANEL_BG,
    border: "none",
    boxShadow: "none",
  };
}

/** The padding of a Card by size preset, in 4px steps: 8, 16 or 24px. */
const CARD_PADDING = { sm: 2, md: 4, lg: 6 } as const;

/** `shadowStyle` wins over the shadow of the variant. */
function cardShadow(props: CardProps) {
  switch (props.shadowStyle) {
    case "md":
      return SHADOW_MD;
    case "sm":
      return SHADOW_SM;
    case "none":
      return "none";
    default:
      return props.variant === "elevated" ? SHADOW_SOFT : undefined;
  }
}

/**
 * A Card has a border at the top level, and none inside another Card.
 * "section" never draws a box. "outline" always draws one.
 */
function cardStyle(props: CardProps, nested: boolean): StyleMap {
  // A section is a heading and its content: no box, no fill, no padding.
  if (props.variant === "section") {
    return {
      flexDirection: "column",
      gap: hasGap(props) ? undefined : spacing(4),
      padding: props.padding !== undefined ? spacing(props.padding) : 0,
      border: "none",
      boxShadow: "none",
      borderRadius: 0,
      background: props.background
        ? backgroundColor(props.background)
        : "transparent",
    };
  }
  const ownBackground =
    props.background ??
    (props.variant === "soft" ? "surface-secondary" : undefined);
  // "outline" has a box even inside another Card.
  const isFlattened = nested && props.variant !== "outline";
  if (isFlattened) {
    const base: StyleMap = {
      flexDirection: "column",
      gap: hasGap(props) ? undefined : spacing(3),
      border: "none",
      boxShadow: "none",
    };
    const isPanel =
      ownBackground !== undefined && ownBackground !== "transparent";
    if (isPanel) {
      return {
        ...base,
        ...innerPanelStyle({ ...props, background: ownBackground }),
      };
    }
    return { ...base, padding: 0, background: "transparent", borderRadius: 0 };
  }
  const sizePadding = CARD_PADDING[props.size ?? "md"];
  return {
    flexDirection: "column",
    gap: hasGap(props) ? undefined : spacing(4),
    padding: props.flush ? 0 : spacing(props.padding ?? sizePadding),
    borderRadius: radius(
      typeof props.radius === "object" ? undefined : (props.radius ?? "xl"),
    ),
    border:
      props.variant === "transparent"
        ? "none"
        : `1px solid ${borderColor(props.borderColor ?? "default")}`,
    background: backgroundColor(
      ownBackground ??
        (props.variant === "transparent" ? "transparent" : undefined),
    ),
    boxShadow: cardShadow(props),
  };
}

/**
 * The layout props of every container, as inputs, and their CSS. The
 * scroll attributes make a scrolling container focusable, so a keyboard
 * user can scroll it.
 */
@Directive({
  host: {
    "data-a2ui-std": "",
    "[attr.tabindex]": "scrollable() ? 0 : null",
    "[attr.data-a2ui-scroll]": "scrollable() ? '' : null",
    "[style]": "hostStyle()",
  },
})
export abstract class CopilotGenerativeUILayoutProps {
  readonly align = input<LayoutProps["align"]>();
  readonly justify = input<LayoutProps["justify"]>();
  readonly wrap = input<LayoutProps["wrap"]>();
  readonly gap = input<LayoutProps["gap"]>();
  readonly rowGap = input<LayoutProps["rowGap"]>();
  readonly columnGap = input<LayoutProps["columnGap"]>();
  readonly padding = input<LayoutProps["padding"]>();
  readonly background = input<LayoutProps["background"]>();
  readonly border = input<LayoutProps["border"]>();
  readonly borderColor = input<LayoutProps["borderColor"]>();
  readonly radius = input<LayoutProps["radius"]>();
  readonly width = input<LayoutProps["width"]>();
  readonly height = input<LayoutProps["height"]>();
  readonly minWidth = input<LayoutProps["minWidth"]>();
  readonly maxWidth = input<LayoutProps["maxWidth"]>();
  readonly minHeight = input<LayoutProps["minHeight"]>();
  readonly maxHeight = input<LayoutProps["maxHeight"]>();
  readonly flex = input<LayoutProps["flex"]>();
  readonly weight = input<LayoutProps["weight"]>();
  readonly aspectRatio = input<LayoutProps["aspectRatio"]>();
  readonly scrollable = input<LayoutProps["scrollable"]>();
  readonly clip = input<LayoutProps["clip"]>();
  readonly shadow = input<LayoutProps["shadow"]>();
  readonly inline = input<LayoutProps["inline"]>();
  readonly role = input<LayoutProps["role"]>();
  readonly flush = input<LayoutProps["flush"]>();
  readonly minSize = input<LayoutProps["minSize"]>();
  readonly maxSize = input<LayoutProps["maxSize"]>();
  readonly disableAutoSpacing = input<LayoutProps["disableAutoSpacing"]>();
  readonly children = input<GenerativeUIChildren>();

  /** The layout props as one object, for the shared style helpers. */
  protected readonly props = computed<LayoutProps>(() => ({
    align: this.align(),
    justify: this.justify(),
    wrap: this.wrap(),
    gap: this.gap(),
    rowGap: this.rowGap(),
    columnGap: this.columnGap(),
    padding: this.padding(),
    background: this.background(),
    border: this.border(),
    borderColor: this.borderColor(),
    radius: this.radius(),
    width: this.width(),
    height: this.height(),
    minWidth: this.minWidth(),
    maxWidth: this.maxWidth(),
    minHeight: this.minHeight(),
    maxHeight: this.maxHeight(),
    flex: this.flex(),
    weight: this.weight(),
    aspectRatio: this.aspectRatio(),
    scrollable: this.scrollable(),
    clip: this.clip(),
    shadow: this.shadow(),
    inline: this.inline(),
    role: this.role(),
    flush: this.flush(),
    minSize: this.minSize(),
    maxSize: this.maxSize(),
    disableAutoSpacing: this.disableAutoSpacing(),
  }));

  protected readonly hostStyle = computed(() =>
    this.computeStyle(this.props()),
  );

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  /** The inline style of the host. Subclasses add their own CSS. */
  protected computeStyle(props: LayoutProps): StyleMap {
    return layoutStyle(props);
  }
}

/**
 * A flex container: the layout props, the accessibility of the envelope,
 * the `onVisible` event, the default gap of its depth in a Card, and an
 * extra style of its own.
 */
@Directive({
  host: {
    "[attr.role]": "hostRole()",
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[attr.aria-live]": "aria()['aria-live'] ?? null",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
  },
})
export abstract class CopilotGenerativeUILayoutContainer extends CopilotGenerativeUILayoutProps {
  readonly onVisible = input<GenerativeUIEventProp>();

  protected readonly aria = injectGenerativeUIAccessibility();
  /** True inside a Card: read above this container's own providers. */
  protected readonly nested = inject(GENERATIVE_UI_CARD_NESTING, {
    skipSelf: true,
  });
  /** The count of containers from the nearest Card, read from above. */
  protected readonly distance = inject(GENERATIVE_UI_CARD_DISTANCE, {
    skipSelf: true,
  });
  protected readonly hostRole = computed(() =>
    namedRole(this.aria(), this.role()),
  );

  constructor() {
    super();
    connectVisibleOnce(() => this.onVisible());
  }

  protected override computeStyle(props: LayoutProps): StyleMap {
    // Inside a Card, background tokens use the lighter panel palette.
    const hasPanelBackground = this.nested && props.background !== undefined;
    return {
      ...layoutStyle(props),
      ...(hasGap(props) ? {} : { gap: defaultGap(this.distance) }),
      ...(hasPanelBackground
        ? { background: panelBackground(props.background) }
        : {}),
      ...defined(this.extraStyle(props)),
    };
  }

  /** The CSS of the container type: direction, default gap, panel. */
  protected extraStyle(_props: LayoutProps): StyleMap {
    return {};
  }
}

export const CHILDREN_TEMPLATE = `<ng-container *copilotGenerativeUIChildren="children()" />`;

/** A flex column, or a row with `direction: "row"`. */
@Component({
  selector: "div[copilotGenerativeUIBox]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [provideContainerContext()],
})
export class CopilotGenerativeUIBox extends CopilotGenerativeUILayoutContainer {
  readonly direction = input<z.output<typeof boxSchema>["direction"]>();

  protected override extraStyle(props: LayoutProps): StyleMap {
    return {
      flexDirection: this.direction() === "row" ? "row" : "column",
      // A bordered Box inside a Card becomes the inner panel, not a 1px box.
      ...(this.nested && props.border ? innerPanelStyle(props) : {}),
    };
  }
}

/** A flex column. */
@Component({
  selector: "div[copilotGenerativeUIColumn]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [provideContainerContext()],
})
export class CopilotGenerativeUIColumn extends CopilotGenerativeUILayoutContainer {
  protected override extraStyle(): StyleMap {
    return { flexDirection: "column" };
  }
}

/** A flex row. Its children are centered on the cross axis, 8px apart. */
@Component({
  selector: "div[copilotGenerativeUIRow]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [provideContainerContext()],
  host: { "[attr.data-a2ui-row]": "justify() ?? 'start'" },
})
export class CopilotGenerativeUIRow extends CopilotGenerativeUILayoutContainer {
  protected override extraStyle(props: LayoutProps): StyleMap {
    return {
      flexDirection: "row",
      alignItems: props.align ? undefined : "center",
      gap: hasGap(props) ? undefined : spacing(2),
    };
  }
}

/**
 * A bordered, padded container. Its children are nested (distance 0). A
 * section draws no box, so its content keeps the nesting level of the Card
 * itself.
 */
@Component({
  selector: "div[copilotGenerativeUICard]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <ng-container *copilotGenerativeUIChildren="child()" />
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  // Not provideCardContext(): a section passes the nesting from above through.
  providers: [
    {
      provide: GENERATIVE_UI_CARD_NESTING,
      useFactory: () =>
        inject(CopilotGenerativeUICard).variant() === "section"
          ? inject(GENERATIVE_UI_CARD_NESTING, { skipSelf: true })
          : true,
    },
    { provide: GENERATIVE_UI_CARD_DISTANCE, useValue: 0 },
  ],
  host: {
    "[attr.data-a2ui-card]": "nested ? 'nested' : 'top'",
    "[attr.data-a2ui-card-variant]": "variant() ?? null",
  },
})
export class CopilotGenerativeUICard extends CopilotGenerativeUILayoutContainer {
  readonly variant = input<CardProps["variant"]>();
  readonly shadowStyle = input<CardProps["shadowStyle"]>();
  readonly size = input<CardProps["size"]>();
  readonly child = input<GenerativeUIChildren>();

  protected override computeStyle(props: LayoutProps): StyleMap {
    const card: CardProps = {
      ...props,
      variant: this.variant(),
      shadowStyle: this.shadowStyle(),
      size: this.size(),
    };
    return { ...layoutStyle(props), ...defined(cardStyle(card, this.nested)) };
  }
}

/** A flexible gap that takes the free space, hidden from screen readers. */
@Component({
  selector: "div[copilotGenerativeUISpacer]",
  template: "",
  // A binding, not a static attribute: the engine's envelope pass runs after
  // the host is created, and a binding is applied in the first change
  // detection, after it.
  host: { "[attr.aria-hidden]": "'true'", "[style]": "hostStyle()" },
})
export class CopilotGenerativeUISpacer {
  readonly minSize = input<number | string>();

  protected readonly hostStyle = computed<StyleMap>(() => ({
    flex: 1,
    minWidth: spacing(this.minSize() ?? 2),
    minHeight: spacing(this.minSize() ?? 2),
  }));

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}

type DividerProps = z.output<typeof dividerSchema>;

/** An `<hr>` rule: horizontal, or vertical with `axis: "vertical"`. */
@Component({
  selector: "hr[copilotGenerativeUIDivider]",
  template: "",
  host: {
    "[attr.aria-orientation]": "axis() === 'vertical' ? 'vertical' : null",
    "[style]": "hostStyle()",
  },
})
export class CopilotGenerativeUIDivider {
  readonly axis = input<DividerProps["axis"]>();
  readonly weight = input<number>();
  readonly color = input<DividerProps["color"]>();
  readonly size = input<number>();
  readonly spacing = input<number | string>();
  readonly flush = input<boolean>();

  protected readonly hostStyle = computed<StyleMap>(() => {
    const line = `${this.size() ?? 1}px solid ${borderColor(this.color() ?? "subtle")}`;
    const margin = this.flush() ? 0 : spacing(this.spacing() ?? 2);
    const isVertical = this.axis() === "vertical";
    return defined({
      border: 0,
      ...(isVertical
        ? { borderLeft: line, margin: `0 ${margin}`, height: "auto" }
        : { borderTop: line, margin: `${margin} 0`, width: "100%" }),
      flexShrink: 0,
      flexGrow: this.weight(),
      alignSelf: "stretch",
    });
  });

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}
