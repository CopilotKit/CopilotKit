import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { layoutDefinitions, LayoutProps } from "../definitions/layout";
import {
  INNER_PANEL_BG,
  backgroundColor,
  borderColor,
  panelBackground,
  radius,
  spacing,
} from "../tokens";
import { useStandardStyles } from "../styles";

const ALIGN_CSS: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  baseline: "baseline",
  stretch: "stretch",
};
const JUSTIFY_CSS: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

function radiusStyle(value: LayoutProps["radius"]): React.CSSProperties {
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

/** Map the shared layout props to CSS. Undefined props produce no CSS. */
export function layoutStyle(p: LayoutProps): React.CSSProperties {
  // Never emit undefined longhands next to a shorthand: React applies an
  // undefined `rowGap` as a removal, and clearing `row-gap` resets the `gap`
  // shorthand in real browsers (jsdom does not model this).
  return defined({
    display: p.inline ? "inline-flex" : "flex",
    alignItems: p.align ? ALIGN_CSS[p.align] : undefined,
    justifyContent: p.justify ? JUSTIFY_CSS[p.justify] : undefined,
    flexWrap: p.wrap,
    gap: spacing(p.gap),
    rowGap: spacing(p.rowGap),
    columnGap: spacing(p.columnGap),
    padding: spacing(p.padding),
    background: backgroundColor(p.background),
    border: p.border
      ? `1px solid ${borderColor(p.borderColor ?? "default")}`
      : undefined,
    ...radiusStyle(p.radius),
    width: spacing(p.width),
    height: spacing(p.height),
    // Containers may shrink below their content and never exceed their parent.
    minWidth: spacing(p.minWidth) ?? 0,
    maxWidth: spacing(p.maxWidth) ?? "100%",
    minHeight: spacing(p.minHeight),
    maxHeight: spacing(p.maxHeight),
    flex: p.flex,
    aspectRatio: p.aspectRatio,
    overflow: p.scrollable ? "auto" : p.clip ? "hidden" : undefined,
    boxShadow: p.shadow ? "0 1px 3px rgba(0,0,0,.12)" : undefined,
    boxSizing: "border-box",
  });
}

/** Drop undefined entries so `extra` never erases a value set by layoutStyle. */
function defined(style: React.CSSProperties): React.CSSProperties {
  return Object.fromEntries(
    Object.entries(style).filter(([, v]) => v !== undefined),
  ) as React.CSSProperties;
}

type BuildChild = (id: string, basePath?: string) => React.ReactNode;

/**
 * Render a bound ChildList: static ids (strings) or, for a template
 * `{ componentId, path }`, the binder's `{ id, basePath }` entries, each
 * built with its basePath so relative bindings resolve per item.
 */
export function renderChildList(
  list: unknown,
  children: RendererProps["children"],
): React.ReactNode {
  if (!Array.isArray(list)) return null;
  // The catalog passes the surface's buildChild, which accepts a basePath.
  const build = children as BuildChild;
  return list.map((item: unknown, i: number) => {
    if (typeof item === "string") {
      return (
        <React.Fragment key={`${item}-${i}`}>{build(item)}</React.Fragment>
      );
    }
    if (item && typeof item === "object" && "id" in item) {
      const node = item as { id: string; basePath?: string };
      return (
        <React.Fragment key={`${node.id}-${node.basePath ?? ""}-${i}`}>
          {build(node.id, node.basePath)}
        </React.Fragment>
      );
    }
    return null;
  });
}

/** Alias of `renderChildList` (ids or expanded template entries). */
export const renderChildren = renderChildList;

// The binder hands absent props over as `null`, so test for both.
const hasGap = (p: LayoutProps) =>
  p.gap != null || p.columnGap != null || p.rowGap != null;

/**
 * True inside a Card. Surfaces have exactly one bordered level (the
 * outer card); everything nested flattens into borderless columns or the
 * single near-white inner panel.
 */
export const CardNestingContext = createContext(false);
/**
 * Containers counted from the nearest Card (null outside any Card). The
 * rhythm: 16px between the groups directly inside a card or form, 8px inside a
 * group (label + control, caption + value).
 */
export const CardDistanceContext = createContext<number | null>(null);
function defaultGap(distance: number | null): string | undefined {
  return spacing(distance === null || distance === 0 ? 4 : 2);
}

/** The inner panel: 12px padding, 8px radius, no border, no shadow. */
function innerPanelStyle(p: LayoutProps): React.CSSProperties {
  return {
    padding: spacing(p.padding ?? 3),
    borderRadius: radius("md"),
    background: panelBackground(p.background) ?? INNER_PANEL_BG,
    border: "none",
    boxShadow: "none",
  };
}

type Extra = (p: any, nested: boolean) => React.CSSProperties;

const container =
  (extra?: Extra, attrs?: (p: any) => Record<string, string | undefined>) =>
  ({ props, children }: RendererProps<any>) => {
    useStandardStyles();
    const nested = useContext(CardNestingContext);
    const distance = useContext(CardDistanceContext);
    return (
      <CardDistanceContext.Provider
        value={distance === null ? null : distance + 1}
      >
        <div
          data-a2ui-std=""
          {...(attrs ? attrs(props) : {})}
          style={{
            ...layoutStyle(props),
            ...(hasGap(props) ? {} : { gap: defaultGap(distance) }),
            // Inside a Card, background tokens use the lighter panel palette.
            ...(nested && props.background
              ? { background: panelBackground(props.background) }
              : {}),
            ...(extra ? defined(extra(props, nested)) : {}),
          }}
        >
          {renderChildren(props.children, children)}
        </div>
      </CardDistanceContext.Provider>
    );
  };

/**
 * Card: bordered at the top level, flattened when nested in another Card.
 * "section" never draws a box; "outline" always does.
 */
function cardStyle(p: any, nested: boolean): React.CSSProperties {
  // A section is a heading plus its content: no box, no fill, no padding.
  if (p.variant === "section") {
    return {
      flexDirection: "column",
      gap: hasGap(p) ? undefined : spacing(4),
      padding: p.padding != null ? spacing(p.padding) : 0,
      border: "none",
      boxShadow: "none",
      borderRadius: 0,
      background: p.background ? backgroundColor(p.background) : "transparent",
    };
  }
  const ownBackground =
    p.background ?? (p.variant === "soft" ? "surface-secondary" : undefined);
  // "outline" is boxed even inside another Card.
  if (nested && p.variant !== "outline") {
    const base: React.CSSProperties = {
      flexDirection: "column",
      gap: hasGap(p) ? undefined : spacing(3),
      border: "none",
      boxShadow: "none",
    };
    if (ownBackground && ownBackground !== "transparent") {
      return {
        ...base,
        ...innerPanelStyle({ ...p, background: ownBackground }),
      };
    }
    return { ...base, padding: 0, background: "transparent", borderRadius: 0 };
  }
  return {
    flexDirection: "column",
    gap: hasGap(p) ? undefined : spacing(4),
    padding: spacing(p.padding ?? 4),
    borderRadius: radius(
      typeof p.radius === "object" ? undefined : (p.radius ?? "xl"),
    ),
    border:
      p.variant === "transparent"
        ? "none"
        : `1px solid ${borderColor(p.borderColor ?? "default")}`,
    background: backgroundColor(
      ownBackground ??
        (p.variant === "transparent" ? "transparent" : undefined),
    ),
    boxShadow:
      p.variant === "elevated" ? "0 1px 3px rgba(0,0,0,.06)" : undefined,
  };
}

function Card({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const nested = useContext(CardNestingContext);
  // A section draws no box, so what it contains keeps its own nesting level.
  const section = props.variant === "section";
  return (
    <CardNestingContext.Provider value={section ? nested : true}>
      <CardDistanceContext.Provider value={0}>
        <div
          data-a2ui-std=""
          data-a2ui-card={nested ? "nested" : "top"}
          data-a2ui-card-variant={props.variant ?? undefined}
          style={{
            ...layoutStyle(props),
            ...defined(cardStyle(props, nested)),
          }}
        >
          {renderChildren(props.children, children)}
        </div>
      </CardDistanceContext.Provider>
    </CardNestingContext.Provider>
  );
}

/** Minimum column width that lets `columns` cards sit side by side. */
const GRID_MIN_TRACK_PX = 520;

/**
 * A numeric column count becomes an auto-fit template: at most `n` columns
 * (each track is at least 1/n of the row) that collapse towards one column
 * once a track would drop below ~260px (two columns) / 520px / n.
 */
export function gridTemplateColumns(p: {
  columns?: number | string;
  minChildWidth?: number | string;
  gap?: number | string;
  columnGap?: number | string;
}): string {
  if (typeof p.columns === "string") return p.columns;
  if (p.minChildWidth != null) {
    return `repeat(auto-fill, minmax(min(100%, ${spacing(p.minChildWidth)}), 1fr))`;
  }
  const n = Math.max(1, Math.floor(p.columns ?? 2));
  if (n === 1) return "minmax(0, 1fr)";
  const gap = spacing(p.columnGap ?? p.gap ?? 4);
  const minTrack = Math.round(Math.max(120, GRID_MIN_TRACK_PX / n));
  return `repeat(auto-fit, minmax(min(100%, max(${minTrack}px, calc((100% - ${n - 1} * ${gap}) / ${n}))), 1fr))`;
}

/**
 * Number of columns the nearest Grid currently renders: the measured track
 * count when available (auto-fit collapses towards one column on narrow
 * widths), else the numeric `columns` prop; undefined when unknown.
 */
const GridColumnsContext = createContext<number | undefined>(undefined);

/** Count the resolved tracks of a laid-out grid ("120px 120px" → 2). */
function measureTracks(el: HTMLElement): number | undefined {
  if (typeof getComputedStyle !== "function") return undefined;
  const tracks = getComputedStyle(el)
    .gridTemplateColumns.split(/\s+/)
    .filter(Boolean);
  // Only trust a fully resolved template (browsers report px tracks).
  return tracks.length > 0 && tracks.every((t) => /^[\d.]+px$/.test(t))
    ? tracks.length
    : undefined;
}

function Grid({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMeasured(measureTracks(el));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const declared =
    typeof props.columns === "number" ||
    (props.columns == null && props.minChildWidth == null)
      ? Math.max(1, Math.floor(props.columns ?? 2))
      : undefined;
  return (
    <GridColumnsContext.Provider value={measured ?? declared}>
      <div
        ref={ref}
        data-a2ui-std=""
        style={{
          ...layoutStyle(props),
          ...defined({
            display: "grid",
            gap: hasGap(props) ? undefined : spacing(4),
            gridTemplateColumns: gridTemplateColumns(props),
            gridTemplateRows:
              typeof props.rows === "number"
                ? `repeat(${props.rows}, auto)`
                : (props.rows as string | undefined),
          }),
        }}
      >
        {renderChildren(props.children, children)}
      </div>
    </GridColumnsContext.Provider>
  );
}

/**
 * A span covering every rendered column becomes `1 / -1` (full row) so it
 * never creates implicit tracks that overflow the grid; smaller spans stay
 * `span N`. Without a known column count the span is used as given.
 */
export function gridItemColumn(
  span: number | undefined,
  columns: number | undefined,
): string | undefined {
  if (!span) return undefined;
  if (columns != null && span >= columns) return "1 / -1";
  return `span ${span}`;
}

function GridItem({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const columns = useContext(GridColumnsContext);
  return (
    <div
      data-a2ui-std=""
      style={{
        ...layoutStyle(props),
        ...defined({
          gridColumn: gridItemColumn(props.span, columns),
          gridRow: props.rowSpan ? `span ${props.rowSpan}` : undefined,
          flexDirection: "column",
        }),
      }}
    >
      {renderChildren(props.children, children)}
    </div>
  );
}

const span = (p: { span?: number; rowSpan?: number }) => ({
  gridColumn: p.span ? `span ${p.span}` : undefined,
  gridRow: p.rowSpan ? `span ${p.rowSpan}` : undefined,
});

export const layoutRenderers = {
  Box: container((p, nested) => ({
    flexDirection: p.direction === "row" ? "row" : "column",
    // A bordered Box inside a Card becomes the inner panel, not a 1px box.
    ...(nested && p.border ? innerPanelStyle(p) : {}),
  })),
  Column: container(() => ({ flexDirection: "column" })),
  // Rows: children centred on the cross axis, 8px apart.
  Row: container(
    (p) => ({
      flexDirection: "row",
      alignItems: p.align ? undefined : "center",
      gap: hasGap(p) ? undefined : spacing(2),
    }),
    (p) => ({ "data-a2ui-row": p.justify ?? "start" }),
  ),
  Grid,
  GridItem,
  Card,
  Flow: container((p) => ({
    display: "grid",
    gap: spacing(p.gap ?? 4),
    gridTemplateColumns: gridTemplateColumns({
      columns: p.columns ?? 3,
      gap: p.gap ?? 4,
    }),
    gridAutoFlow: p.layout === "fixed" ? "row" : "dense",
  })),
  FlowItem: container((p) => ({
    ...span(p),
    flexDirection: "column",
    aspectRatio: p.aspectRatio ?? "1 / 1",
  })),
  Carousel: container((p) => ({
    flexDirection: "row",
    gap: spacing(p.gap ?? 2),
    overflowX: "auto",
    scrollSnapType:
      (p.snap ?? "proximity") === "none"
        ? undefined
        : `x ${p.snap ?? "proximity"}`,
  })),
  CarouselItem: container(() => ({
    flex: "0 0 auto",
    flexDirection: "column",
    scrollSnapAlign: "start",
  })),
  Spacer: ({ props }: RendererProps<any>) => (
    <div
      aria-hidden
      style={{
        flex: 1,
        minWidth: spacing(props.minSize ?? 2),
        minHeight: spacing(props.minSize ?? 2),
      }}
    />
  ),
  Divider: ({ props }: RendererProps<any>) => (
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
  ),
  Animate: container(),
  AnimateGroup: container(),
  AnimateItem: container(),
  Transition: container(),
} satisfies CatalogRenderers<typeof layoutDefinitions>;
