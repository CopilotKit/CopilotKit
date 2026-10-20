import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { z } from "zod";
import type { GenerativeUIInvokeResult } from "../errors";
import { child } from "../refs";
import { Lightbox, openUrl } from "./lightbox";
import type { LightboxImage } from "./lightbox";
import {
  ALIGN,
  BACKGROUNDS,
  BORDER_COLORS,
  INNER_PANEL_BG,
  JUSTIFY,
  RADII,
  SHADOW_MD,
  SHADOW_SM,
  SHADOW_SOFT,
  WRAP,
  backgroundColor,
  borderColor,
  panelBackground,
  radius,
  spacing,
  textColor,
} from "./tokens";
import { namedRole, useGenerativeUIAccessibility } from "../accessibility";
import { useStandardStyles } from "./styles";

// ---- Shared schemas ----

/** A number is a count of 4px steps. A string is raw CSS. */
export const sizeValue = z.union([z.number(), z.string()]);

/** The A2UI `weight`: how much of the free space of a Row or Column to take. */
export const weightProp = z
  .number()
  .optional()
  .describe("flex-grow in a Row or Column");

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
  weight: weightProp,
  aspectRatio: z.string().optional(),
  scrollable: z.boolean().optional(),
  clip: z.boolean().optional(),
  shadow: z.boolean().optional(),
  inline: z.boolean().optional(),
  role: z.string().optional().describe("ARIA role"),
  flush: z.boolean().optional().describe("No padding"),
  minSize: sizeValue.optional().describe("Minimum width and height"),
  maxSize: sizeValue.optional().describe("Maximum width and height"),
  disableAutoSpacing: z
    .boolean()
    .optional()
    .describe("No default gap between children"),
};

const layoutSchema = z.object(layoutProps);

/** The arguments of a click or visibility event: none. */
const NO_ARGS = z.object({});

type EventProp = (
  args: z.input<typeof NO_ARGS>,
) => Promise<GenerativeUIInvokeResult>;

/**
 * The `onVisible` event of every container: sent once, the first time the
 * container scrolls into view (ChatGPT's `onVisible`).
 */
export const VISIBLE_EVENT = {
  onVisible: {
    description:
      "Sent once, the first time the container scrolls into view. Use it to load more content lazily.",
    parameters: NO_ARGS,
  },
} as const;

type WithEvents<Props> = Props & { onVisible?: EventProp };

export type LayoutProps = z.output<typeof layoutSchema>;

/** The slot of every container: a list of children or a template. */
export const CHILDREN_SLOT = { children: "multiple" } as const;

type WithChildren<Props> = WithEvents<Props> & { children?: ReactNode };

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
  shadowStyle: z
    .enum(["none", "sm", "md"])
    .optional()
    .describe("Overrides the shadow of the variant"),
  size: z
    .enum(["sm", "md", "lg"])
    .optional()
    .describe('The padding preset: 8, 16 or 24px. Default "md"'),
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
  showArrows: z.boolean().optional().describe("Default true"),
  activeIndex: z
    .number()
    .optional()
    .describe(
      'The index of the slide in view. Bind it with { "path": "/x" } to read or set it',
    ),
  previousLabel: z.string().optional().describe('Default "Previous"'),
  nextLabel: z.string().optional().describe('Default "Next"'),
  snap: z.enum(["none", "proximity", "mandatory"]).optional(),
  snapAlign: z.enum(["start", "center", "end"]).optional(),
});
const CAROUSEL_MEDIA_SIZES = ["sm", "md", "lg"] as const;
const carouselMediaItemSchema = z.object({
  ...layoutProps,
  url: z.string().describe("Image URL"),
  description: z
    .string()
    .optional()
    .describe("What the image shows, for screen readers"),
  size: z
    .enum(CAROUSEL_MEDIA_SIZES)
    .optional()
    .describe('The width: "sm" 160px, "md" 240px, "lg" 320px. Default "md"'),
  aspectRatio: z.string().optional().describe('Default "4 / 3"'),
  href: z.string().optional().describe("Opens this URL in a new tab"),
  lightbox: z
    .boolean()
    .optional()
    .describe("Default true: a click opens all slides full-screen"),
});
const spacerSchema = z.object({ minSize: sizeValue.optional() });
const tabsSchema = z.object({
  tabs: z
    .array(
      z.object({
        title: z.string().describe("The tab title"),
        child: child("The id of the panel component"),
      }),
    )
    .describe("One entry per tab"),
  selectedIndex: z
    .number()
    .optional()
    .describe(
      'The open tab. Default 0. Bind it with { "@path": "/x" } to read it',
    ),
  weight: weightProp,
});
const dividerSchema = z.object({
  axis: z
    .enum(["horizontal", "vertical"])
    .optional()
    .describe('Default "horizontal"'),
  weight: weightProp,
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
type CarouselProps = z.output<typeof carouselSchema> & {
  /** From the engine: `activeIndex` is writable. */
  setActiveIndex: (value: number) => void;
};
type CarouselMediaItemProps = z.output<typeof carouselMediaItemSchema> & {
  onClick?: EventProp;
};

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
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
  stretch: "stretch",
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
    gap: spacing(props.gap) ?? (props.disableAutoSpacing ? 0 : undefined),
    rowGap: spacing(props.rowGap),
    columnGap: spacing(props.columnGap),
    padding: props.flush ? 0 : spacing(props.padding),
    background: backgroundColor(props.background),
    border: props.border
      ? `1px solid ${borderColor(props.borderColor ?? "default")}`
      : undefined,
    ...radiusStyle(props.radius),
    width: spacing(props.width),
    height: spacing(props.height),
    // A container can shrink below its content and never gets wider than
    // its parent.
    minWidth: spacing(props.minWidth ?? props.minSize) ?? 0,
    maxWidth: spacing(props.maxWidth ?? props.maxSize) ?? "100%",
    minHeight: spacing(props.minHeight ?? props.minSize),
    maxHeight: spacing(props.maxHeight ?? props.maxSize),
    flex: props.flex,
    flexGrow: props.weight,
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
  props.rowGap !== undefined ||
  props.disableAutoSpacing === true;

/**
 * Sends `onVisible` once, the first time the element scrolls into view. No
 * observer is made when the event is not bound.
 */
export function useVisibleOnce(
  ref: React.RefObject<HTMLElement | null>,
  onVisible: EventProp | undefined,
) {
  const hasFired = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!onVisible || !element || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver((entries) => {
      if (hasFired.current) return;
      if (entries.some((entry) => entry.isIntersecting)) {
        hasFired.current = true;
        void onVisible({});
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, onVisible]);
}

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
    const aria = useGenerativeUIAccessibility();
    const nested = useContext(CardNestingContext);
    const distance = useContext(CardDistanceContext);
    const ref = useRef<HTMLDivElement>(null);
    useVisibleOnce(ref, props.onVisible);
    // Inside a Card, background tokens use the lighter panel palette.
    const hasPanelBackground = nested && props.background !== undefined;
    return (
      <CardDistanceContext.Provider
        value={distance === null ? null : distance + 1}
      >
        <div
          ref={ref}
          data-a2ui-std=""
          role={namedRole(aria, props.role)}
          {...aria}
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
  } satisfies CSSProperties;
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

function Card(props: WithChildren<CardProps> & { child?: ReactNode }) {
  useStandardStyles();
  const aria = useGenerativeUIAccessibility();
  const nested = useContext(CardNestingContext);
  const ref = useRef<HTMLDivElement>(null);
  useVisibleOnce(ref, props.onVisible);
  // A section draws no box, so its content keeps the nesting level.
  const isSection = props.variant === "section";
  return (
    <CardNestingContext.Provider value={isSection ? nested : true}>
      <CardDistanceContext.Provider value={0}>
        <div
          ref={ref}
          role={namedRole(aria, props.role)}
          {...aria}
          data-a2ui-std=""
          data-a2ui-card={nested ? "nested" : "top"}
          data-a2ui-card-variant={props.variant}
          {...scrollAttributes(props.scrollable)}
          style={{
            ...layoutStyle(props),
            ...defined(cardStyle(props, nested)),
          }}
        >
          {props.child}
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

/** The width of a CarouselMediaItem by size. */
const CAROUSEL_MEDIA_WIDTH: Record<
  (typeof CAROUSEL_MEDIA_SIZES)[number],
  number
> = { sm: 160, md: 240, lg: 320 };

/**
 * A horizontal snap scroller with previous and next arrows. A Carousel
 * always scrolls, so it can always take keyboard focus. With a `label`, it
 * is a named region for screen readers. `activeIndex` is writable: setting
 * it scrolls that slide into view, and a scroll writes the index of the
 * snapped slide back.
 */
function Carousel(props: WithChildren<CarouselProps>) {
  useStandardStyles();
  const nested = useContext(CardNestingContext);
  const scroller = useRef<HTMLDivElement>(null);
  useVisibleOnce(scroller, props.onVisible);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const snap = props.snap ?? "proximity";
  const showArrows = props.showArrows !== false;
  const hasLabel = props.label !== undefined;

  const slides = () =>
    Array.from(scroller.current?.children ?? []) as HTMLElement[];
  const update = () => {
    const element = scroller.current;
    if (!element) return;
    setCanPrev(element.scrollLeft > 4);
    setCanNext(
      element.scrollLeft + element.clientWidth < element.scrollWidth - 4,
    );
  };
  const scrollTo = (index: number) => {
    const element = scroller.current;
    const target = slides()[index];
    if (!element || !target) return;
    const left = target.offsetLeft - element.offsetLeft;
    // jsdom has no scrollTo on elements.
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ left, behavior: "smooth" });
    } else {
      element.scrollLeft = left;
    }
  };
  /** The index of the slide nearest to the left edge. */
  const nearest = () => {
    const element = scroller.current;
    if (!element) return 0;
    let best = 0;
    let bestDistance = Infinity;
    slides().forEach((slide, index) => {
      const distance = Math.abs(
        slide.offsetLeft - element.offsetLeft - element.scrollLeft,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  };

  useEffect(update, []);
  const { activeIndex, setActiveIndex } = props;
  useEffect(() => {
    if (typeof activeIndex === "number") scrollTo(activeIndex);
    // scrollTo reads the DOM; it does not change between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = () => {
    update();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const index = nearest();
      if (index !== activeIndex) setActiveIndex(index);
    }, 120);
  };

  const arrow = (direction: -1 | 1, isEnabled: boolean, label: string) => (
    <button
      type="button"
      aria-label={label}
      disabled={!isEnabled}
      data-a2ui-carousel-arrow={direction < 0 ? "prev" : "next"}
      onClick={(event) => {
        event.stopPropagation();
        scrollTo(Math.max(0, nearest() + direction));
      }}
      style={{
        position: "absolute",
        top: "50%",
        [direction < 0 ? "left" : "right"]: 4,
        transform: "translateY(-50%)",
        width: 32,
        height: 32,
        borderRadius: 9999,
        border: `1px solid ${borderColor("default")}`,
        background: backgroundColor("surface-elevated"),
        color: textColor("default"),
        boxShadow: SHADOW_SM,
        cursor: isEnabled ? "pointer" : "default",
        opacity: isEnabled ? 1 : 0,
        pointerEvents: isEnabled ? "auto" : "none",
        transition: "opacity .15s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        lineHeight: 1,
        zIndex: 1,
      }}
    >
      {direction < 0 ? "‹" : "›"}
    </button>
  );

  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <div
        ref={scroller}
        data-a2ui-std=""
        data-a2ui-carousel=""
        {...scrollAttributes(true)}
        role={props.role ?? (hasLabel ? "region" : undefined)}
        aria-label={props.label}
        aria-roledescription={hasLabel ? "carousel" : undefined}
        onScroll={onScroll}
        style={{
          ...layoutStyle(props),
          ...(nested && props.background
            ? { background: panelBackground(props.background) }
            : {}),
          flexDirection: "row",
          gap: spacing(props.gap ?? 2),
          overflowX: "auto",
          scrollSnapType: snap === "none" ? undefined : `x ${snap}`,
          scrollbarWidth: "none",
        }}
      >
        {props.children}
      </div>
      {showArrows
        ? arrow(-1, canPrev, props.previousLabel ?? "Previous")
        : null}
      {showArrows ? arrow(1, canNext, props.nextLabel ?? "Next") : null}
    </div>
  );
}

/**
 * A slide with an image on top. A click on the image opens a lightbox over
 * every media slide of the same carousel, with the clicked one selected.
 * `href` or a bound `onClick` take over the click instead.
 */
function CarouselMediaItem(props: WithChildren<CarouselMediaItemProps>) {
  useStandardStyles();
  const [open, setOpen] = useState<{
    images: LightboxImage[];
    index: number;
  } | null>(null);
  const width = CAROUSEL_MEDIA_WIDTH[props.size ?? "md"];
  const hasHref = typeof props.href === "string" && props.href !== "";
  const hasAction = props.onClick !== undefined;
  const showsLightbox = props.lightbox !== false && !hasHref && !hasAction;
  const isClickable = showsLightbox || hasHref || hasAction;
  const onClick = (event: MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (hasHref) {
      openUrl(props.href);
      return;
    }
    if (hasAction) {
      void props.onClick?.({});
      return;
    }
    if (!showsLightbox) return;
    const own = event.currentTarget;
    const scope =
      own.closest("[data-a2ui-carousel]") ?? own.parentElement?.parentElement;
    const slides = Array.from(
      scope?.querySelectorAll<HTMLImageElement>(
        "[data-a2ui-carousel-media] > img",
      ) ?? [],
    );
    const images = slides.map((img) => ({ src: img.src, alt: img.alt }));
    const index = Math.max(
      0,
      slides.findIndex((img) => img === own),
    );
    setOpen(
      images.length > 0
        ? { images, index }
        : { images: [{ src: props.url, alt: props.description }], index: 0 },
    );
  };
  return (
    <div
      data-a2ui-std=""
      data-a2ui-carousel-media=""
      role={props.role}
      style={{
        ...layoutStyle(props),
        flex: "0 0 auto",
        flexDirection: "column",
        scrollSnapAlign: "start",
        width,
        gap: spacing(props.gap ?? 2),
      }}
    >
      <img
        src={props.url}
        alt={props.description ?? ""}
        loading="lazy"
        onClick={isClickable ? onClick : undefined}
        data-a2ui-lightbox-trigger={showsLightbox ? "" : undefined}
        style={{
          display: "block",
          width: "100%",
          aspectRatio: props.aspectRatio ?? "4 / 3",
          objectFit: "cover",
          borderRadius: radius("lg"),
          cursor: showsLightbox
            ? "zoom-in"
            : isClickable
              ? "pointer"
              : undefined,
        }}
      />
      {props.children}
      {open ? (
        <Lightbox
          images={open.images}
          index={open.index}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

const CarouselItem = container(() => ({
  flex: "0 0 auto",
  flexDirection: "column",
  scrollSnapAlign: "start",
}));

type TabsProps = z.output<typeof tabsSchema> & {
  setSelectedIndex?: (index: number) => void;
};

/**
 * Tabs with one panel per tab: the `child` of each entry, rendered by the
 * engine. The tab list is one tab stop: the arrow keys, Home and End move
 * between the tabs and open them.
 */
function Tabs(props: TabsProps) {
  useStandardStyles();
  const id = useId();
  const [ownIndex, setOwnIndex] = useState(0);
  const tabs = props.tabs ?? [];
  const count = tabs.length;
  const selected = Math.min(
    Math.max(0, props.selectedIndex ?? ownIndex),
    Math.max(0, count - 1),
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number, focus = false) => {
    setOwnIndex(index);
    props.setSelectedIndex?.(index);
    if (focus) tabRefs.current[index]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : undefined;
    const next =
      step !== undefined
        ? (selected + step + count) % count
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? count - 1
            : undefined;
    if (next === undefined || count === 0) return;
    event.preventDefault();
    select(next, true);
  };
  if (count === 0) return null;
  return (
    <div
      data-a2ui-std=""
      data-a2ui-tabs=""
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing(3),
        width: "100%",
        minWidth: 0,
        flexGrow: props.weight,
      }}
    >
      <div
        role="tablist"
        onKeyDown={onKeyDown}
        style={{
          display: "flex",
          gap: spacing(1),
          borderBottom: `1px solid ${borderColor("default")}`,
          overflowX: "auto",
        }}
      >
        {tabs.map((tab, index) => {
          const isSelected = index === selected;
          return (
            <button
              key={`${tab.title}-${index}`}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-selected={isSelected}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={isSelected ? 0 : -1}
              data-a2ui-input=""
              onClick={() => select(index)}
              style={{
                flexShrink: 0,
                padding: `${spacing(2)} ${spacing(3)}`,
                marginBottom: -1,
                border: "none",
                borderBottom: `2px solid ${isSelected ? textColor("default") : "transparent"}`,
                background: "transparent",
                color: isSelected
                  ? textColor("default")
                  : textColor("secondary"),
                font: "inherit",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {tab.title}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) =>
        index === selected ? (
          <div
            key={index}
            role="tabpanel"
            id={`${id}-panel-${index}`}
            aria-labelledby={`${id}-tab-${index}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: spacing(3),
            }}
          >
            {tab.child}
          </div>
        ) : null,
      )}
    </div>
  );
}

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
  const line = `${props.size ?? 1}px solid ${borderColor(props.color ?? "subtle")}`;
  const margin = props.flush ? 0 : spacing(props.spacing ?? 2);
  const isVertical = props.axis === "vertical";
  return (
    <hr
      aria-orientation={isVertical ? "vertical" : undefined}
      style={{
        border: 0,
        ...(isVertical
          ? { borderLeft: line, margin: `0 ${margin}`, height: "auto" }
          : { borderTop: line, margin: `${margin} 0`, width: "100%" }),
        flexShrink: 0,
        flexGrow: props.weight,
        alignSelf: "stretch",
      }}
    />
  );
}

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
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Column: {
    component: Column,
    description:
      "A vertical flex container. Its default gap already separates sections, so do not add padding, background or a Spacer for space.",
    props: layoutSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Row: {
    component: Row,
    description:
      'A horizontal flex container. For a label and value pair, use a Row with justify "spaceBetween": a Caption on the left and a Text with fontWeight "medium" on the right. Put buttons in a Row at the bottom of a Card: one Button with variant "primary", and the default or "borderless" for the others.',
    props: layoutSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Grid: {
    component: Grid,
    description:
      "A CSS grid container. On a narrow screen, its columns collapse towards one column.",
    props: gridSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  GridItem: {
    component: GridItem,
    description:
      "A cell of a Grid, with an optional span. A span that covers all rendered columns fills the row.",
    props: gridItemSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Card: {
    component: Card,
    description:
      'A bordered, padded container, only for an interactive panel (controls, a form, a configurator). Tables, charts and text do not need one. Give it a Title and a Caption. Separate the groups in it with a Divider or the plain gap, never with a nested Card or a bordered Box. Variant "section" is a heading and content without a box. Variant "outline" always has a box. In markdown mode, a Card without controls renders as "section" unless it sets variant or border.',
    props: cardSchema,
    events: VISIBLE_EVENT,
    slots: { child: "single", children: "multiple" } as const,
  },
  Flow: {
    component: Flow,
    description:
      "A masonry-like grid that packs cells of different sizes. Put FlowItem children in it.",
    props: flowSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  FlowItem: {
    component: FlowItem,
    description: "A cell of a Flow, with an optional span.",
    props: flowItemSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  Carousel: {
    component: Carousel,
    description:
      'A row that scrolls horizontally and snaps to its slides, with previous and next arrows. Put CarouselItem or CarouselMediaItem children in it. Bind activeIndex with { "path": "/x" } to read or set the slide in view.',
    props: carouselSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
    writable: ["activeIndex"] as const,
  },
  CarouselItem: {
    component: CarouselItem,
    description: "A slide of a Carousel.",
    props: layoutSchema,
    events: VISIBLE_EVENT,
    slots: CHILDREN_SLOT,
  },
  CarouselMediaItem: {
    component: CarouselMediaItem,
    description:
      'A slide of a Carousel with an image on top and its children (a Caption, a Text) under it. size "sm" is 160px, "md" 240px (default), "lg" 320px wide. A click on the image opens all slides full-screen, unless href or onClick is set.',
    props: carouselMediaItemSchema,
    events: {
      ...VISIBLE_EVENT,
      onClick: {
        description:
          "Sent when the user clicks the image. It replaces the full-screen view.",
        parameters: NO_ARGS,
      },
    },
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
    description:
      'A line between two groups: horizontal, or vertical with axis "vertical" in a Row.',
    props: dividerSchema,
  },
  Tabs: {
    component: Tabs,
    description:
      'Tabs that show one panel at a time. Each tab has a title and the id of its panel component: "tabs":[{"title":"Specs","child":"specs"}].',
    props: tabsSchema,
    writable: ["selectedIndex"] as const,
  },
};
