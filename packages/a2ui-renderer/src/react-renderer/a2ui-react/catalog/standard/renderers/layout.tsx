import React from "react";
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
  Grid: container((p) => ({
    display: "grid",
    gap: hasGap(p) ? undefined : spacing(4),
    gridTemplateColumns: gridTemplateColumns(p),
    gridTemplateRows:
      typeof p.rows === "number"
        ? `repeat(${p.rows}, auto)`
        : (p.rows as string | undefined),
  })),
  GridItem: container((p) => ({ ...span(p), flexDirection: "column" })),
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
