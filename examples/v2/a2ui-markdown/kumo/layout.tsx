"use client";

import { createContext, useContext, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Grid as KumoGrid,
  GridItem as KumoGridItem,
  LayerCard,
  Tabs as KumoTabs,
} from "@cloudflare/kumo";
import type { KumoGridGap } from "@cloudflare/kumo";
import { Separator } from "@cloudflare/kumo/primitives/separator";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import {
  backgroundOf,
  borderColorOf,
  defined,
  layoutStyle,
  sizeOf,
} from "./style";
import { standardComponent } from "./types";
import type { StandardProps } from "./types";
import { useVisibleOnce } from "./visible";

// ---- Grid ----

/**
 * The Kumo gap preset of a standard `gap` (4px steps). Kumo's "base" gap
 * grows with the viewport (8, 24, then 32px), which is too wide inside a
 * chat card, so an unset gap is "sm" (12px).
 */
export function gapOf(gap: number | undefined): KumoGridGap {
  if (gap === undefined) return "sm";
  if (gap === 0) return "none";
  return gap <= 5 ? "sm" : "lg";
}

/** The width of each Kumo grid gap preset ("sm" is Tailwind's gap-3). */
const GAP_CSS: Record<KumoGridGap, string> = {
  none: "0px",
  sm: "12px",
  base: "24px",
  lg: "32px",
};

/** The minimum width at which `columns` cards sit side by side. */
const GRID_MIN_TRACK_PX = 520;

/**
 * The `grid-template-columns` of a Grid, as the standard Grid computes it:
 * at most `columns` tracks that collapse toward one column when the
 * container gets narrow. Kumo's grid variants follow viewport breakpoints
 * instead, which squeezes the columns in the narrow chat panel.
 */
export function gridTemplateColumns(
  props: {
    columns?: number | string;
    minChildWidth?: number | string;
  },
  /** The column gap the grid really has, as CSS. */
  gap = GAP_CSS.sm,
) {
  if (typeof props.columns === "string") return props.columns;
  if (props.minChildWidth !== undefined) {
    return `repeat(auto-fill, minmax(min(100%, ${sizeOf(props.minChildWidth)}), 1fr))`;
  }
  const count = Math.max(1, Math.floor(props.columns ?? 2));
  if (count === 1) return "minmax(0, 1fr)";
  const minTrack = Math.round(Math.max(120, GRID_MIN_TRACK_PX / count));
  return `repeat(auto-fit, minmax(min(100%, max(${minTrack}px, calc((100% - ${count - 1} * ${gap}) / ${count}))), 1fr))`;
}

/** The column count of the nearest Grid, for the spans of its items. */
const GridColumnsContext = createContext<number | undefined>(undefined);

/** Grid: a Kumo Grid with the gap preset and the standard column template. */
export function Grid(props: StandardProps<"Grid">) {
  const ref = useRef<HTMLDivElement>(null);
  useVisibleOnce(ref, props.onVisible);
  const columns =
    typeof props.columns === "number"
      ? Math.max(1, Math.floor(props.columns))
      : props.columns === undefined && props.minChildWidth === undefined
        ? 2
        : undefined;
  const numericGap = typeof props.gap === "number" ? props.gap : undefined;
  return (
    <GridColumnsContext.Provider value={columns}>
      <KumoGrid
        ref={ref}
        gap={gapOf(numericGap)}
        role={props.role}
        style={{
          ...layoutStyle({
            ...props,
            // A string gap is raw CSS: keep it. A number uses the preset.
            gap: typeof props.gap === "string" ? props.gap : undefined,
          }),
          ...defined({
            // The template must use the gap the grid really has, or a
            // column more than fits makes auto-fit drop one.
            gridTemplateColumns: gridTemplateColumns(
              props,
              sizeOf(props.columnGap) ??
                (typeof props.gap === "string"
                  ? props.gap
                  : GAP_CSS[gapOf(numericGap)]),
            ),
            gridTemplateRows:
              typeof props.rows === "number"
                ? `repeat(${props.rows}, auto)`
                : props.rows,
          }),
        }}
      >
        {props.children}
      </KumoGrid>
    </GridColumnsContext.Provider>
  );
}

/** A span that covers every column becomes the full row. */
function gridColumnOf(span: number | undefined, columns: number | undefined) {
  if (!span) return undefined;
  if (columns !== undefined && span >= columns) return "1 / -1";
  return `span ${span}`;
}

/** GridItem: a Kumo GridItem with the span of the standard one. */
export function GridItem(props: StandardProps<"GridItem">) {
  const ref = useRef<HTMLDivElement>(null);
  useVisibleOnce(ref, props.onVisible);
  const columns = useContext(GridColumnsContext);
  return (
    <KumoGridItem
      ref={ref}
      role={props.role}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        minWidth: 0,
        ...layoutStyle(props),
        ...defined({
          gridColumn: gridColumnOf(props.span, columns),
          gridRow: props.rowSpan ? `span ${props.rowSpan}` : undefined,
        }),
      }}
    >
      {props.children}
    </KumoGridItem>
  );
}

// ---- Card ----

export type CardKind = "layer" | "section" | "plain";

/**
 * How a Card variant is drawn: a Kumo LayerCard, a section (a heading and
 * its content: no box, like the standard one), or a transparent box.
 */
export function cardKindOf(
  variant: StandardProps<"Card">["variant"],
): CardKind {
  if (variant === "section") return "section";
  if (variant === "transparent") return "plain";
  return "layer";
}

/** True inside a Card: a nested Card draws no second box. */
const CardNestingContext = createContext(false);

const CARD_PADDING = { sm: 2, md: 4, lg: 6 } as const;

function cardShadow(props: StandardProps<"Card">) {
  switch (props.shadowStyle) {
    case "md":
      return "var(--a2ui-shadow-md)";
    case "sm":
      return "var(--a2ui-shadow-sm)";
    case "none":
      return "none";
    default:
      return props.variant === "elevated" ? "var(--a2ui-shadow-md)" : undefined;
  }
}

/**
 * Card: a Kumo LayerCard. Inside another Card it draws no box (a panel
 * when it has a background), except an "outline" Card, like the standard
 * Card.
 */
export function Card(props: StandardProps<"Card">) {
  const aria = useGenerativeUIAccessibility();
  const isNested = useContext(CardNestingContext);
  const ref = useRef<HTMLDivElement>(null);
  useVisibleOnce(ref, props.onVisible);
  const kind = cardKindOf(props.variant);
  const column: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };
  const content = (
    <>
      {props.child}
      {props.children}
    </>
  );

  const isFlattened = isNested && props.variant !== "outline";
  if (kind === "section" || isFlattened) {
    const background =
      props.background ??
      (props.variant === "soft" && isFlattened
        ? "surface-secondary"
        : undefined);
    const isPanel = isFlattened && background !== undefined;
    return (
      <CardNestingContext.Provider value={kind === "section" ? isNested : true}>
        <div
          ref={ref}
          {...aria}
          role={props.role}
          style={{
            ...column,
            gap: kind === "section" ? "16px" : "12px",
            ...(isPanel
              ? {
                  padding: sizeOf(props.padding ?? 3),
                  borderRadius: "var(--a2ui-radius-md)",
                }
              : {}),
            ...layoutStyle({ ...props, background }),
          }}
        >
          {content}
        </div>
      </CardNestingContext.Provider>
    );
  }

  const padding = props.flush
    ? 0
    : sizeOf(props.padding ?? CARD_PADDING[props.size ?? "md"]);
  const background =
    props.background ??
    (props.variant === "soft" ? "surface-secondary" : undefined);
  const style: CSSProperties = {
    ...column,
    ...layoutStyle({ ...props, background, padding: undefined }),
    ...defined({ padding, boxShadow: cardShadow(props) }),
  };
  return (
    <CardNestingContext.Provider value={true}>
      {kind === "plain" ? (
        <div ref={ref} {...aria} role={props.role} style={style}>
          {content}
        </div>
      ) : (
        <LayerCard ref={ref} {...aria} role={props.role} style={style}>
          {content}
        </LayerCard>
      )}
    </CardNestingContext.Provider>
  );
}

// ---- Box ----

const StandardBox = standardComponent("Box");

/**
 * Box: a Kumo LayerCard when it draws a box (a border, a shadow or a
 * background), else the standard flex container. Inside a Card, a boxed
 * Box is a borderless panel, like the standard Box.
 */
export function Box(props: StandardProps<"Box">) {
  const aria = useGenerativeUIAccessibility();
  const isNested = useContext(CardNestingContext);
  const ref = useRef<HTMLDivElement>(null);
  const isBoxed = Boolean(props.border || props.shadow || props.background);
  useVisibleOnce(ref, isBoxed ? props.onVisible : undefined);
  if (!isBoxed) return <StandardBox {...props} />;
  const style: CSSProperties = {
    display: props.inline ? "inline-flex" : "flex",
    flexDirection: props.direction === "row" ? "row" : "column",
    gap: "12px",
    padding: sizeOf(props.padding ?? 3),
    // The LayerCard ring is the border.
    ...layoutStyle({ ...props, border: false }),
  };
  if (isNested) {
    return (
      <div
        ref={ref}
        {...aria}
        role={props.role}
        style={{
          ...style,
          borderRadius: "var(--a2ui-radius-md)",
          background:
            backgroundOf(props.background) ?? "var(--a2ui-color-panel)",
          boxShadow: "none",
        }}
      >
        {props.children}
      </div>
    );
  }
  return (
    <LayerCard ref={ref} {...aria} role={props.role} style={style}>
      {props.children}
    </LayerCard>
  );
}

// ---- Divider ----

/** Divider: the Base UI Separator that Kumo re-exports, in a Kumo line color. */
export function Divider(props: StandardProps<"Divider">) {
  const isVertical = props.axis === "vertical";
  const line = `${props.size ?? 1}px solid ${borderColorOf(props.color ?? "default")}`;
  const margin = props.flush ? 0 : sizeOf(props.spacing ?? 2);
  return (
    <Separator
      orientation={isVertical ? "vertical" : "horizontal"}
      style={{
        border: 0,
        ...(isVertical
          ? { borderLeft: line, margin: `0 ${margin}`, alignSelf: "stretch" }
          : { borderTop: line, margin: `${margin} 0`, width: "100%" }),
        flexShrink: 0,
        flexGrow: props.weight,
      }}
    />
  );
}

// ---- Tabs ----

/** Tabs: Kumo Tabs (the tab list), and the panel of the selected tab. */
export function Tabs(props: StandardProps<"Tabs">) {
  const [ownIndex, setOwnIndex] = useState(0);
  const tabs = props.tabs ?? [];
  const selected = Math.min(
    Math.max(0, props.selectedIndex ?? ownIndex),
    Math.max(0, tabs.length - 1),
  );
  const select = (value: string) => {
    const index = Number(value);
    setOwnIndex(index);
    props.setSelectedIndex(index);
  };
  const panel = tabs[selected];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        flexGrow: props.weight,
        minWidth: 0,
      }}
    >
      <KumoTabs
        variant="underline"
        tabs={tabs.map((tab, index) => ({
          value: String(index),
          label: tab.title,
        }))}
        value={String(selected)}
        onValueChange={select}
      />
      {panel ? (
        <div role="tabpanel" aria-label={panel.title}>
          {panel.child}
        </div>
      ) : null}
    </div>
  );
}

export const layoutOverrides = {
  Box: { component: Box },
  Grid: { component: Grid },
  GridItem: { component: GridItem },
  Card: { component: Card },
  Divider: { component: Divider },
  Tabs: { component: Tabs },
};
