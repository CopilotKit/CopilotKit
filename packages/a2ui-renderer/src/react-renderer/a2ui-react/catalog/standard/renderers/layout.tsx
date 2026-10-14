import React from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { layoutDefinitions, LayoutProps } from "../definitions/layout";
import { backgroundColor, borderColor, radius, spacing } from "../tokens";

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
    minWidth: spacing(p.minWidth),
    maxWidth: spacing(p.maxWidth),
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

/** Render each child id via `children(id)` (the catalog's buildChild). */
export function renderChildren(
  ids: string[] | undefined,
  children: RendererProps["children"],
): React.ReactNode {
  return (ids ?? []).map((id, i) => (
    <React.Fragment key={`${id}-${i}`}>{children(id)}</React.Fragment>
  ));
}

const container =
  (extra?: (p: any) => React.CSSProperties) =>
  ({ props, children }: RendererProps<any>) => (
    <div
      style={{
        ...layoutStyle(props),
        ...(extra ? defined(extra(props)) : {}),
      }}
    >
      {renderChildren(props.children, children)}
    </div>
  );

const span = (p: { span?: number; rowSpan?: number }) => ({
  gridColumn: p.span ? `span ${p.span}` : undefined,
  gridRow: p.rowSpan ? `span ${p.rowSpan}` : undefined,
});

export const layoutRenderers = {
  Box: container((p) => ({
    flexDirection: p.direction === "row" ? "row" : "column",
  })),
  Column: container(() => ({ flexDirection: "column" })),
  Row: container(() => ({ flexDirection: "row" })),
  Grid: container((p) => ({
    display: "grid",
    gridTemplateColumns:
      typeof p.columns === "string"
        ? p.columns
        : p.minChildWidth !== undefined
          ? `repeat(auto-fill, minmax(${spacing(p.minChildWidth)}, 1fr))`
          : `repeat(${p.columns ?? 2}, minmax(0, 1fr))`,
    gridTemplateRows:
      typeof p.rows === "number"
        ? `repeat(${p.rows}, auto)`
        : (p.rows as string | undefined),
  })),
  GridItem: container((p) => ({ ...span(p), flexDirection: "column" })),
  Card: container((p) => ({
    flexDirection: "column",
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
      p.variant === "elevated" ? "0 2px 8px rgba(0,0,0,.1)" : undefined,
  })),
  Flow: container((p) => ({
    display: "grid",
    gap: spacing(p.gap ?? 4),
    gridTemplateColumns: `repeat(${p.columns ?? 3}, minmax(0, 1fr))`,
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
        borderTop: `${props.size ?? 1}px solid ${borderColor(props.color ?? "default")}`,
        margin: props.flush ? 0 : `${spacing(props.spacing ?? 2)} 0`,
        width: "100%",
      }}
    />
  ),
  Animate: container(),
  AnimateGroup: container(),
  AnimateItem: container(),
  Transition: container(),
} satisfies CatalogRenderers<typeof layoutDefinitions>;
