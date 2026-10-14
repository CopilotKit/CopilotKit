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
import { backgroundColor, borderColor, radius, spacing } from "../tokens";
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
  return {
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
  };
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

const container =
  (extra?: (p: any) => React.CSSProperties) =>
  ({ props, children }: RendererProps<any>) => {
    useStandardStyles();
    return (
      <div
        data-a2ui-std=""
        style={{
          ...layoutStyle(props),
          ...(extra ? defined(extra(props)) : {}),
        }}
      >
        {renderChildren(props.children, children)}
      </div>
    );
  };

const hasGap = (p: LayoutProps) =>
  p.gap !== undefined || p.columnGap !== undefined || p.rowGap !== undefined;

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
  if (p.minChildWidth !== undefined) {
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
    (props.columns === undefined && props.minChildWidth === undefined)
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
  if (columns !== undefined && span >= columns) return "1 / -1";
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
  Box: container((p) => ({
    flexDirection: p.direction === "row" ? "row" : "column",
  })),
  Column: container(() => ({ flexDirection: "column" })),
  // ChatGPT auto-spaces row children 8px apart.
  Row: container((p) => ({
    flexDirection: "row",
    gap: hasGap(p) ? undefined : spacing(2),
  })),
  Grid,
  GridItem,
  Card: container((p) => ({
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
      p.background ??
        (p.variant === "soft"
          ? "surface-secondary"
          : p.variant === "transparent"
            ? "transparent"
            : "surface"),
    ),
    boxShadow:
      p.variant === "elevated" ? "0 1px 3px rgba(0,0,0,.06)" : undefined,
  })),
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
        minWidth: spacing(props.minSize),
        minHeight: spacing(props.minSize),
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
