import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { z } from "zod";
import {
  ALIGN,
  BACKGROUNDS,
  BORDER_COLORS,
  INNER_PANEL_BG,
  JUSTIFY,
  RADII,
  SHADOW_SM,
  SHADOW_SOFT,
  WRAP,
  backgroundColor,
  borderColor,
  panelBackground,
  radius,
  spacing,
} from "./tokens";
import { useStandardStyles } from "./styles";

// ---- Shared schemas ----

/** A number is a count of 4px steps. A string is raw CSS. */
export const sizeValue = z.union([z.number(), z.string()]);

export const radiusValue = z.union([
  z.enum(RADII),
  z.number(),
  z.string(),
  z.object({
    topLeft: z.string().optional(),
    topRight: z.string().optional(),
    bottomLeft: z.string().optional(),
    bottomRight: z.string().optional(),
  }),
]);

/**
 * The layout props of every container. Spread them into a props schema:
 * `z.object({ ...layoutProps, variant: ... })`. The children of a container
 * are a slot, not a prop.
 */
export const layoutProps = {
  align: z.enum(ALIGN).optional(),
  justify: z.enum(JUSTIFY).optional(),
  wrap: z.enum(WRAP).optional(),
  gap: sizeValue.optional().describe("4px steps when a number"),
  rowGap: sizeValue.optional(),
  columnGap: sizeValue.optional(),
  padding: sizeValue.optional().describe("4px steps when a number"),
  background: z
    .string()
    .optional()
    .describe(
      `One of ${BACKGROUNDS.join("|")} or a CSS color. Leave it unset. Only one summary panel in a Card can use "surface-secondary"`,
    ),
  border: z.boolean().optional(),
  borderColor: z.enum(BORDER_COLORS).optional(),
  radius: radiusValue.optional(),
  width: sizeValue.optional(),
  height: sizeValue.optional(),
  minWidth: sizeValue.optional(),
  maxWidth: sizeValue.optional(),
  minHeight: sizeValue.optional(),
  maxHeight: sizeValue.optional(),
  flex: z.number().optional(),
  aspectRatio: z.string().optional(),
  scrollable: z.boolean().optional(),
  clip: z.boolean().optional(),
  shadow: z.boolean().optional(),
  inline: z.boolean().optional(),
};

const layoutSchema = z.object(layoutProps);

export type LayoutProps = z.output<typeof layoutSchema>;

/** The slot of every container: a list of children or a template. */
export const CHILDREN_SLOT = { children: "multiple" } as const;

type WithChildren<Props> = Props & { children?: ReactNode };

const boxSchema = z.object({
  ...layoutProps,
  direction: z.enum(["col", "row"]).optional().describe('Default "col"'),
});
const gridSchema = z.object({
  ...layoutProps,
  columns: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Column count or CSS template. Default 2"),
  minChildWidth: sizeValue.optional(),
  rows: z.union([z.number(), z.string()]).optional(),
});
const gridItemSchema = z.object({
  ...layoutProps,
  span: z.number().optional(),
  rowSpan: z.number().optional(),
});
const cardSchema = z.object({
  ...layoutProps,
  variant: z
    .enum(["default", "outline", "section", "soft", "elevated", "transparent"])
    .optional(),
});
const flowSchema = z.object({
  ...layoutProps,
  columns: z.number().optional(),
  rows: z.number().optional(),
  layout: z.enum(["pack", "fixed"]).optional().describe('Default "pack"'),
});
const flowItemSchema = z.object({
  ...layoutProps,
  span: z.number().optional(),
  rowSpan: z.number().optional(),
  aspectRatio: z.string().optional().describe('Default "1 / 1"'),
  aspectMode: z.enum(["soft", "fixed"]).optional(),
});
const carouselSchema = z.object({
  ...layoutProps,
  label: z
    .string()
    .optional()
    .describe("A short name of the carousel for screen readers"),
  visibleItems: z.number().optional(),
  showArrows: z.boolean().optional(),
  snap: z.enum(["none", "proximity", "mandatory"]).optional(),
  snapAlign: z.enum(["start", "center", "end"]).optional(),
});
const spacerSchema = z.object({ minSize: sizeValue.optional() });
const dividerSchema = z.object({
  color: z.enum(BORDER_COLORS).optional(),
  size: z.number().optional(),
  spacing: sizeValue.optional(),
  flush: z.boolean().optional(),
});

type BoxProps = z.output<typeof boxSchema>;
type GridProps = z.output<typeof gridSchema>;
type GridItemProps = z.output<typeof gridItemSchema>;
type CardProps = z.output<typeof cardSchema>;
type FlowProps = z.output<typeof flowSchema>;
type FlowItemProps = z.output<typeof flowItemSchema>;
type CarouselProps = z.output<typeof carouselSchema>;

// ---- Style helpers ----

const ALIGN_CSS: Record<(typeof ALIGN)[number], string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  baseline: "baseline",
  stretch: "stretch",
};
const JUSTIFY_CSS: Record<(typeof JUSTIFY)[number], string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

/** The CSS of a `radius` prop: one radius, or one for each corner. */
export function radiusStyle(value: LayoutProps["radius"]) {
  if (typeof value === "string" || typeof value === "number") {
    return { borderRadius: radius(value) };
  }
  if (value === undefined) return {};
  return {
    borderTopLeftRadius: radius(value.topLeft),
    borderTopRightRadius: radius(value.topRight),
    borderBottomLeftRadius: radius(value.bottomLeft),
    borderBottomRightRadius: radius(value.bottomRight),
  };
}

/**
 * Removes the undefined entries, so a later spread never erases a value. An
 * undefined longhand next to a shorthand is a removal in React: clearing
 * `row-gap` resets the `gap` shorthand in real browsers (jsdom does not
 * model this).
 */
export function defined(style: CSSProperties) {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  );
}

/** The CSS of the shared layout props. An unset prop gives no CSS. */
export function layoutStyle(props: LayoutProps) {
  const overflow = props.scrollable
    ? "auto"
    : props.clip
      ? "hidden"
      : undefined;
  return defined({
    display: props.inline ? "inline-flex" : "flex",
    alignItems: props.align ? ALIGN_CSS[props.align] : undefined,
    justifyContent: props.justify ? JUSTIFY_CSS[props.justify] : undefined,
    flexWrap: props.wrap,
    gap: spacing(props.gap),
    rowGap: spacing(props.rowGap),
    columnGap: spacing(props.columnGap),
    padding: spacing(props.padding),
    background: backgroundColor(props.background),
    border: props.border
      ? `1px solid ${borderColor(props.borderColor ?? "default")}`
      : undefined,
    ...radiusStyle(props.radius),
    width: spacing(props.width),
    height: spacing(props.height),
    // A container can shrink below its content and never gets wider than
    // its parent.
    minWidth: spacing(props.minWidth) ?? 0,
    maxWidth: spacing(props.maxWidth) ?? "100%",
    minHeight: spacing(props.minHeight),
    maxHeight: spacing(props.maxHeight),
    flex: props.flex,
    aspectRatio: props.aspectRatio,
    overflow,
    boxShadow: props.shadow ? SHADOW_SM : undefined,
    boxSizing: "border-box",
  });
}

/**
 * The attributes of a container that scrolls. A keyboard user must be able
 * to focus it to scroll it.
 */
function scrollAttributes(isScrollable: boolean | undefined) {
  if (!isScrollable) return {};
  return { tabIndex: 0, "data-a2ui-scroll": "" };
}

const hasGap = (props: LayoutProps) =>
  props.gap !== undefined ||
  props.columnGap !== undefined ||
  props.rowGap !== undefined;

/**
 * True inside a Card. A surface has only one bordered level (the outer
 * Card). Everything inside it becomes borderless columns or the one
 * near-white inner panel.
 */
export const CardNestingContext = createContext(false);

/**
 * The count of containers from the nearest Card, or `null` outside of a
 * Card. The rhythm: 16px between the groups directly inside a Card, 8px in a
 * group (label and control, caption and value).
 */
export const CardDistanceContext = createContext<number | null>(null);

function defaultGap(distance: number | null) {
  return spacing(distance === null || distance === 0 ? 4 : 2);
}

/** The inner panel: 12px padding, 8px radius, no border, no shadow. */
function innerPanelStyle(props: LayoutProps) {
  return {
    padding: spacing(props.padding ?? 3),
    borderRadius: radius("md"),
    background: panelBackground(props.background) ?? INNER_PANEL_BG,
    border: "none",
    boxShadow: "none",
  };
}

type ExtraStyle<Props> = (props: Props, nested: boolean) => CSSProperties;
type ExtraAttributes<Props> = (
  props: Props,
) => Record<string, string | number | undefined>;

/**
 * A flex container component: the layout props, the default gap of its
 * depth in a Card, and an extra style of its own.
 */
function container<Props extends LayoutProps = LayoutProps>(
  extra?: ExtraStyle<Props>,
  attributes?: ExtraAttributes<Props>,
) {
  return function Container(props: WithChildren<Props>) {
    useStandardStyles();
    const nested = useContext(CardNestingContext);
    const distance = useContext(CardDistanceContext);
    // Inside a Card, background tokens use the lighter panel palette.
    const hasPanelBackground = nested && props.background !== undefined;
    return (
      <CardDistanceContext.Provider
        value={distance === null ? null : distance + 1}
      >
        <div
          data-a2ui-std=""
          {...scrollAttributes(props.scrollable)}
          {...attributes?.(props)}
          style={{
            ...layoutStyle(props),
            ...(hasGap(props) ? {} : { gap: defaultGap(distance) }),
            ...(hasPanelBackground
              ? { background: panelBackground(props.background) }
              : {}),
            ...(extra ? defined(extra(props, nested)) : {}),
          }}
        >
          {props.children}
        </div>
      </CardDistanceContext.Provider>
    );
  };
}

// ---- Card ----

/**
 * A Card has a border at the top level, and none inside another Card.
 * "section" never draws a box. "outline" always draws one.
 */
function cardStyle(props: CardProps, nested: boolean) {
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
    } satisfies CSSProperties;
  }
  const ownBackground =
    props.background ??
    (props.variant === "soft" ? "surface-secondary" : undefined);
  // "outline" has a box even inside another Card.
  const isFlattened = nested && props.variant !== "outline";
  if (isFlattened) {
    const base: CSSProperties = {
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
    return {
      ...base,
      padding: 0,
      background: "transparent",
      borderRadius: 0,
    } satisfies CSSProperties;
  }
  return {
    flexDirection: "column",
    gap: hasGap(props) ? undefined : spacing(4),
    padding: spacing(props.padding ?? 4),
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
    boxShadow: props.variant === "elevated" ? SHADOW_SOFT : undefined,
  } satisfies CSSProperties;
}

function Card(props: WithChildren<CardProps>) {
  useStandardStyles();
  const nested = useContext(CardNestingContext);
  // A section draws no box, so its content keeps the nesting level.
  const isSection = props.variant === "section";
  return (
    <CardNestingContext.Provider value={isSection ? nested : true}>
      <CardDistanceContext.Provider value={0}>
        <div
          data-a2ui-std=""
          data-a2ui-card={nested ? "nested" : "top"}
          data-a2ui-card-variant={props.variant}
          {...scrollAttributes(props.scrollable)}
          style={{
            ...layoutStyle(props),
            ...defined(cardStyle(props, nested)),
          }}
        >
          {props.children}
        </div>
      </CardDistanceContext.Provider>
    </CardNestingContext.Provider>
  );
}

// ---- Grid ----

/** The minimum width at which `columns` cards sit side by side. */
const GRID_MIN_TRACK_PX = 520;

/**
 * The `grid-template-columns` of a Grid. A number of columns becomes an
 * auto-fit template: at most `n` columns, which collapse towards one column
 * when a track gets narrower than 520px / n (260px for two columns).
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
 * The count of columns that the nearest Grid renders now: the measured
 * track count when the browser gives it (auto-fit collapses columns on
 * narrow widths), else the numeric `columns` prop. `undefined` when unknown.
 */
const GridColumnsContext = createContext<number | undefined>(undefined);

/** The count of resolved tracks of a laid-out grid ("120px 120px" is 2). */
function measureTracks(element: HTMLElement) {
  if (typeof getComputedStyle !== "function") return undefined;
  const tracks = getComputedStyle(element)
    .gridTemplateColumns.split(/\s+/)
    .filter(Boolean);
  // Only a fully resolved template is trusted (browsers report px tracks).
  const isResolved =
    tracks.length > 0 && tracks.every((track) => /^[\d.]+px$/.test(track));
  return isResolved ? tracks.length : undefined;
}

/** The column count that the Grid props give, or `undefined` when unknown. */
function declaredColumns(props: GridProps) {
  if (typeof props.columns === "number") {
    return Math.max(1, Math.floor(props.columns));
  }
  const isDefault =
    props.columns === undefined && props.minChildWidth === undefined;
  return isDefault ? 2 : undefined;
}

function Grid(props: WithChildren<GridProps>) {
  useStandardStyles();
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setMeasured(measureTracks(element));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const declared = declaredColumns(props);
  return (
    <GridColumnsContext.Provider value={measured ?? declared}>
      <div
        ref={ref}
        data-a2ui-std=""
        {...scrollAttributes(props.scrollable)}
        style={{
          ...layoutStyle(props),
          ...defined({
            display: "grid",
            gap: hasGap(props) ? undefined : spacing(4),
            gridTemplateColumns: gridTemplateColumns(props),
            gridTemplateRows:
              typeof props.rows === "number"
                ? `repeat(${props.rows}, auto)`
                : props.rows,
          }),
        }}
      >
        {props.children}
      </div>
    </GridColumnsContext.Provider>
  );
}

/**
 * The `grid-column` of a GridItem. A span that covers every rendered column
 * becomes `1 / -1` (the full row), so it never adds implicit tracks that
 * overflow the grid. A smaller span stays `span N`. Without a known column
 * count, the span is used as given.
 */
export function gridItemColumn(
  span: number | undefined,
  columns: number | undefined,
) {
  if (!span) return undefined;
  if (columns !== undefined && span >= columns) return "1 / -1";
  return `span ${span}`;
}

function GridItem(props: WithChildren<GridItemProps>) {
  useStandardStyles();
  const columns = useContext(GridColumnsContext);
  return (
    <div
      data-a2ui-std=""
      {...scrollAttributes(props.scrollable)}
      style={{
        ...layoutStyle(props),
        ...defined({
          gridColumn: gridItemColumn(props.span, columns),
          gridRow: props.rowSpan ? `span ${props.rowSpan}` : undefined,
          flexDirection: "column",
        }),
      }}
    >
      {props.children}
    </div>
  );
}

const spanStyle = (props: { span?: number; rowSpan?: number }) => ({
  gridColumn: props.span ? `span ${props.span}` : undefined,
  gridRow: props.rowSpan ? `span ${props.rowSpan}` : undefined,
});

// ---- Containers ----

const Box = container((props: BoxProps, nested) => ({
  flexDirection: props.direction === "row" ? "row" : "column",
  // A bordered Box inside a Card becomes the inner panel, not a 1px box.
  ...(nested && props.border ? innerPanelStyle(props) : {}),
}));

const Column = container(() => ({ flexDirection: "column" }));

// Row children are centered on the cross axis, 8px apart.
const Row = container(
  (props) => ({
    flexDirection: "row",
    alignItems: props.align ? undefined : "center",
    gap: hasGap(props) ? undefined : spacing(2),
  }),
  (props) => ({ "data-a2ui-row": props.justify ?? "start" }),
);

const Flow = container((props: FlowProps) => ({
  display: "grid",
  gap: spacing(props.gap ?? 4),
  gridTemplateColumns: gridTemplateColumns({
    columns: props.columns ?? 3,
    gap: props.gap ?? 4,
  }),
  gridAutoFlow: props.layout === "fixed" ? "row" : "dense",
}));

const FlowItem = container((props: FlowItemProps) => ({
  ...spanStyle(props),
  flexDirection: "column",
  aspectRatio: props.aspectRatio ?? "1 / 1",
}));

/**
 * A Carousel always scrolls, so it can always take keyboard focus. With a
 * `label`, it is a named region for screen readers.
 */
const Carousel = container(
  (props: CarouselProps) => {
    const snap = props.snap ?? "proximity";
    return {
      flexDirection: "row",
      gap: spacing(props.gap ?? 2),
      overflowX: "auto",
      scrollSnapType: snap === "none" ? undefined : `x ${snap}`,
    };
  },
  (props) => {
    const hasLabel = props.label !== undefined;
    return {
      ...scrollAttributes(true),
      role: hasLabel ? "region" : undefined,
      "aria-label": props.label,
      "aria-roledescription": hasLabel ? "carousel" : undefined,
    };
  },
);

const CarouselItem = container(() => ({
  flex: "0 0 auto",
  flexDirection: "column",
  scrollSnapAlign: "start",
}));

function Spacer(props: z.output<typeof spacerSchema>) {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: 1,
        minWidth: spacing(props.minSize ?? 2),
        minHeight: spacing(props.minSize ?? 2),
      }}
    />
  );
}

function Divider(props: z.output<typeof dividerSchema>) {
  return (
    <hr
      style={{
        border: 0,
        borderTop: `${props.size ?? 1}px solid ${borderColor(props.color ?? "subtle")}`,
        margin: props.flush ? 0 : `${spacing(props.spacing ?? 2)} 0`,
        width: "100%",
        flexShrink: 0,
        alignSelf: "stretch",
      }}
    />
  );
}

const PassThrough = container();

const PASS_THROUGH_DESCRIPTION =
  "A container that renders its children as they are. It is an animation hint.";

/**
 * The standard layout components: containers, Spacer and Divider. Give
 * them to `createGenerativeUI({ components: { ...layoutComponents } })`.
 * Every container has a "multiple" `children` slot, so it takes a list of
 * child ids or a template `{ componentId, path }`.
 */
export const layoutComponents = {
  Box: {
    component: Box,
    description:
      'A flex container. It stacks its children in a column (direction "row" puts them in a row). Use it to group children with gap, padding, border, radius or background.',
    props: boxSchema,
    slots: CHILDREN_SLOT,
  },
  Column: {
    component: Column,
    description:
      "A vertical flex container. Its default gap already separates sections, so do not add padding, background or a Spacer for space.",
    props: layoutSchema,
    slots: CHILDREN_SLOT,
  },
  Row: {
    component: Row,
    description:
      'A horizontal flex container. For a label and value pair, use a Row with justify "between": a Caption on the left and a Text with weight "medium" on the right. Put buttons in a Row at the bottom of a Card: one primary Button, and variant "ghost" for the others.',
    props: layoutSchema,
    slots: CHILDREN_SLOT,
  },
  Grid: {
    component: Grid,
    description:
      "A CSS grid container. On a narrow screen, its columns collapse towards one column.",
    props: gridSchema,
    slots: CHILDREN_SLOT,
  },
  GridItem: {
    component: GridItem,
    description:
      "A cell of a Grid, with an optional span. A span that covers all rendered columns fills the row.",
    props: gridItemSchema,
    slots: CHILDREN_SLOT,
  },
  Card: {
    component: Card,
    description:
      'A bordered, padded container, only for an interactive panel (controls, a form, a configurator). Tables, charts and text do not need one. Give it a Title and a Caption. Separate the groups in it with a Divider or the plain gap, never with a nested Card or a bordered Box. Variant "section" is a heading and content without a box. Variant "outline" always has a box. In markdown mode, a Card without controls renders as "section" unless it sets variant or border.',
    props: cardSchema,
    slots: CHILDREN_SLOT,
  },
  Flow: {
    component: Flow,
    description:
      "A masonry-like grid that packs cells of different sizes. Put FlowItem children in it.",
    props: flowSchema,
    slots: CHILDREN_SLOT,
  },
  FlowItem: {
    component: FlowItem,
    description: "A cell of a Flow, with an optional span.",
    props: flowItemSchema,
    slots: CHILDREN_SLOT,
  },
  Carousel: {
    component: Carousel,
    description:
      "A row that scrolls horizontally and snaps to its slides. Put CarouselItem children in it.",
    props: carouselSchema,
    slots: CHILDREN_SLOT,
  },
  CarouselItem: {
    component: CarouselItem,
    description: "A slide of a Carousel.",
    props: layoutSchema,
    slots: CHILDREN_SLOT,
  },
  Spacer: {
    component: Spacer,
    description:
      "Flexible empty space. You almost never need it: use the default gap.",
    props: spacerSchema,
  },
  Divider: {
    component: Divider,
    description: "A horizontal line between two groups.",
    props: dividerSchema,
  },
  Animate: {
    component: PassThrough,
    description: PASS_THROUGH_DESCRIPTION,
    props: layoutSchema,
    slots: CHILDREN_SLOT,
  },
  AnimateGroup: {
    component: PassThrough,
    description: PASS_THROUGH_DESCRIPTION,
    props: layoutSchema,
    slots: CHILDREN_SLOT,
  },
  AnimateItem: {
    component: PassThrough,
    description: PASS_THROUGH_DESCRIPTION,
    props: layoutSchema,
    slots: CHILDREN_SLOT,
  },
  Transition: {
    component: PassThrough,
    description: PASS_THROUGH_DESCRIPTION,
    props: layoutSchema,
    slots: CHILDREN_SLOT,
  },
};
