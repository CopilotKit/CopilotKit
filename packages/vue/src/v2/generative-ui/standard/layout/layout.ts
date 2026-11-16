import { computed, inject, provide, ref } from "vue";
import type { ComputedRef, InjectionKey } from "vue";
import {
  INNER_PANEL_BG,
  SHADOW_MD,
  SHADOW_SM,
  SHADOW_SOFT,
  backgroundColor,
  borderColor,
  defined,
  layoutStyle,
  panelBackground,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type {
  LayoutProps,
  StyleMap,
  cardSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { namedRole, useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import { provideContainerContext, useCardNesting } from "../context";
import type { GenerativeUIEventProp } from "../context";
import { useVisibleOnce } from "../visible-once";

// The shared code of the layout components: the props of every container,
// the style rules of a container, a Card and a Grid, and the contexts that
// a Grid and a Carousel give their items.

/**
 * The layout props of every container, and its `onVisible` event. The SFC
 * compiler cannot read the zod types, so the keys are written out here.
 */
export interface LayoutContainerProps {
  align?: LayoutProps["align"];
  justify?: LayoutProps["justify"];
  wrap?: LayoutProps["wrap"];
  gap?: LayoutProps["gap"];
  rowGap?: LayoutProps["rowGap"];
  columnGap?: LayoutProps["columnGap"];
  padding?: LayoutProps["padding"];
  background?: LayoutProps["background"];
  border?: LayoutProps["border"];
  borderColor?: LayoutProps["borderColor"];
  radius?: LayoutProps["radius"];
  width?: LayoutProps["width"];
  height?: LayoutProps["height"];
  minWidth?: LayoutProps["minWidth"];
  maxWidth?: LayoutProps["maxWidth"];
  minHeight?: LayoutProps["minHeight"];
  maxHeight?: LayoutProps["maxHeight"];
  flex?: LayoutProps["flex"];
  weight?: LayoutProps["weight"];
  aspectRatio?: LayoutProps["aspectRatio"];
  scrollable?: LayoutProps["scrollable"];
  clip?: LayoutProps["clip"];
  shadow?: LayoutProps["shadow"];
  inline?: LayoutProps["inline"];
  role?: LayoutProps["role"];
  flush?: LayoutProps["flush"];
  minSize?: LayoutProps["minSize"];
  maxSize?: LayoutProps["maxSize"];
  disableAutoSpacing?: LayoutProps["disableAutoSpacing"];
  /** Sent once, the first time the container scrolls into view. */
  onVisible?: GenerativeUIEventProp;
}

/** True when the props set a gap, so the default gap does not apply. */
export function hasGap(props: LayoutProps) {
  return (
    props.gap !== undefined ||
    props.columnGap !== undefined ||
    props.rowGap !== undefined ||
    props.disableAutoSpacing === true
  );
}

/** 16px between the groups directly inside a Card, 8px in a group. */
function defaultGap(distance: number | null) {
  return spacing(distance === null || distance === 0 ? 4 : 2);
}

/** The inner panel: 12px padding, 8px radius, no border, no shadow. */
export function innerPanelStyle(props: LayoutProps): StyleMap {
  return {
    padding: spacing(props.padding ?? 3),
    borderRadius: radius("md"),
    background: panelBackground(props.background) ?? INNER_PANEL_BG,
    border: "none",
    boxShadow: "none",
  };
}

/**
 * The attributes of a container that scrolls. A keyboard user must be able
 * to focus it to scroll it.
 */
export function scrollAttributes(isScrollable: boolean | undefined) {
  if (!isScrollable) return {};
  return { tabindex: 0, "data-a2ui-scroll": "" };
}

/** The extra style of a container type, from its props and its nesting. */
type ExtraStyle<Props> = (props: Props, nested: boolean) => StyleMap;

/**
 * The setup of a flex container: the layout props, the accessibility of the
 * envelope, the `onVisible` event, the default gap of its depth in a Card,
 * and an extra style of its own. It makes the component a container for
 * its children (one level further from the Card).
 *
 * @param props - The props of the component.
 * @param extraStyle - The CSS of the container type: direction, default
 *   gap, panel. It wins over the layout props.
 * @returns `root`, the template ref of the root element, and `attributes`,
 *   the attributes and style to bind on it.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const props = defineProps<LayoutContainerProps>();
 * const { root, attributes } = useLayoutContainer(props, () => ({
 *   flexDirection: "column",
 * }));
 * </script>
 *
 * <template>
 *   <div ref="root" v-bind="attributes"><slot name="children" /></div>
 * </template>
 * ```
 */
export function useLayoutContainer<Props extends LayoutContainerProps>(
  props: Props,
  extraStyle: ExtraStyle<Props>,
) {
  useStandardStyles();
  const aria = useGenerativeUIAccessibility();
  const nested = useCardNesting();
  const distance = provideContainerContext();
  const root = ref<HTMLElement | null>(null);
  useVisibleOnce(root, () => props.onVisible);
  const attributes = computed(() => {
    // Inside a Card, background tokens use the lighter panel palette.
    const hasPanelBackground = nested.value && props.background !== undefined;
    return {
      "data-a2ui-std": "",
      role: namedRole(aria.value, props.role),
      ...aria.value,
      ...scrollAttributes(props.scrollable),
      style: {
        ...layoutStyle(props),
        ...(hasGap(props) ? {} : { gap: defaultGap(distance.value) }),
        ...(hasPanelBackground
          ? { background: panelBackground(props.background) }
          : {}),
        ...defined(extraStyle(props, nested.value)),
      },
    };
  });
  return { root, attributes };
}

// ---- Card ----

export type CardProps = z.output<typeof cardSchema>;

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
 * The style of a Card. A Card has a border at the top level, and none
 * inside another Card. "section" never draws a box. "outline" always draws
 * one.
 *
 * @param props - The props of the Card.
 * @param nested - Whether the Card is inside another Card.
 */
export function cardStyle(props: CardProps, nested: boolean): StyleMap {
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

// ---- Grid ----

/** The minimum width at which `columns` cards sit side by side. */
const GRID_MIN_TRACK_PX = 520;

/**
 * The `grid-template-columns` of a Grid. A number of columns becomes an
 * auto-fit template: at most `n` columns, which collapse towards one column
 * when a track gets narrower than 520px / n (260px for two columns).
 *
 * @param props - The column props of a Grid or a Flow.
 */
export function gridTemplateColumns(props: {
  columns?: number | string;
  minChildWidth?: number | string;
  gap?: number | string;
  columnGap?: number | string;
}) {
  if (typeof props.columns === "string") return props.columns;
  if (props.minChildWidth !== undefined) {
    return `repeat(auto-fill, minmax(min(100%, ${spacing(props.minChildWidth)}), 1fr))`;
  }
  const count = Math.max(1, Math.floor(props.columns ?? 2));
  if (count === 1) return "minmax(0, 1fr)";
  const gap = spacing(props.columnGap ?? props.gap ?? 4);
  const minTrack = Math.round(Math.max(120, GRID_MIN_TRACK_PX / count));
  return `repeat(auto-fit, minmax(min(100%, max(${minTrack}px, calc((100% - ${count - 1} * ${gap}) / ${count}))), 1fr))`;
}

/**
 * The `grid-column` of a GridItem. A span that covers every rendered column
 * becomes `1 / -1` (the full row), so it never adds implicit tracks that
 * overflow the grid. A smaller span stays `span N`. Without a known column
 * count, the span is used as given.
 *
 * @param span - The `span` prop of the GridItem.
 * @param columns - The count of columns that the Grid renders, if known.
 *
 * @example gridItemColumn(3, 2) // "1 / -1"
 */
export function gridItemColumn(
  span: number | undefined,
  columns: number | undefined,
) {
  if (!span) return undefined;
  if (columns !== undefined && span >= columns) return "1 / -1";
  return `span ${span}`;
}

/** The count of resolved tracks of a laid-out grid ("120px 120px" is 2). */
export function measureTracks(element: HTMLElement) {
  if (typeof getComputedStyle !== "function") return undefined;
  const tracks = getComputedStyle(element)
    .gridTemplateColumns.split(/\s+/)
    .filter(Boolean);
  // Only a fully resolved template is trusted (browsers report px tracks).
  const isResolved =
    tracks.length > 0 && tracks.every((track) => /^[\d.]+px$/.test(track));
  return isResolved ? tracks.length : undefined;
}

/**
 * The count of columns that the nearest Grid renders now: the measured
 * track count when the browser gives it (auto-fit collapses columns on
 * narrow widths), else the numeric `columns` prop. `undefined` when unknown.
 */
const GENERATIVE_UI_GRID_COLUMNS: InjectionKey<
  ComputedRef<number | undefined>
> = Symbol("GENERATIVE_UI_GRID_COLUMNS");

/** Gives the GridItems below a Grid the count of columns it renders. */
export function provideGridColumns(columns: ComputedRef<number | undefined>) {
  provide(GENERATIVE_UI_GRID_COLUMNS, columns);
}

/** The column count of the nearest Grid, or `null` outside one. */
export function useGridColumns() {
  return inject(GENERATIVE_UI_GRID_COLUMNS, null);
}

// ---- Carousel ----

/**
 * The width of one slide when the Carousel sets `visibleItems`, so that many
 * slides fill its width (gaps included). `undefined`: slides size to their
 * content.
 */
const GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH: InjectionKey<
  ComputedRef<string | undefined>
> = Symbol("GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH");

/** Gives the CarouselItems below a Carousel the width of one slide. */
export function provideCarouselSlideWidth(
  width: ComputedRef<string | undefined>,
) {
  provide(GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH, width);
}

/** The slide width of the nearest Carousel, or `null` outside one. */
export function useCarouselSlideWidth() {
  return inject(GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH, null);
}
