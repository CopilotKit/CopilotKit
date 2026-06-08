"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { RendererProps } from "@copilotkit/a2ui-renderer";
import { StockCard } from "@/components/StockCard";
import { getStock } from "@/lib/stocks";

/* The runtime resolves `{path}` bindings against the data model before
   handing props to renderers, so prop values below are post-resolution. */

const GAP = {
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-10",
};

const Stack = ({
  props,
  children,
}: RendererProps<{
  children: string[] | { componentId: string; path: string };
  gap?: keyof typeof GAP;
}>) => (
  <div className={clsx("flex flex-col", GAP[props.gap ?? "md"])}>
    {Array.isArray(props.children)
      ? props.children.map((id) => <Slot key={id} render={children(id)} />)
      : null}
  </div>
);

const Row = ({
  props,
  children,
}: RendererProps<{
  children: string[];
  gap?: keyof typeof GAP;
}>) => (
  <div className={clsx("flex flex-wrap items-center", GAP[props.gap ?? "sm"])}>
    {Array.isArray(props.children)
      ? props.children.map((id) => <Slot key={id} render={children(id)} />)
      : null}
  </div>
);

const Grid = ({
  props,
  children,
}: RendererProps<{
  children: string[];
  columns?: number;
  gap?: keyof typeof GAP;
}>) => {
  const cols = props.columns ?? 2;
  const colMap: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  };
  return (
    <div className={clsx("grid", colMap[cols], GAP[props.gap ?? "md"])}>
      {Array.isArray(props.children)
        ? props.children.map((id) => <Slot key={id} render={children(id)} />)
        : null}
    </div>
  );
};

const Heading = ({
  props,
}: RendererProps<{ text: string; level?: "1" | "2" | "3" }>) => {
  const level = props.level ?? "2";
  const Tag = level === "1" ? "h1" : level === "3" ? "h3" : "h2";
  const sizes = {
    "1": "text-[26px] font-semibold tracking-tight leading-[1.1]",
    "2": "text-[18px] font-semibold tracking-tight leading-[1.2]",
    "3": "text-[14px] font-semibold leading-tight",
  } as const;
  return (
    <Tag className={clsx(sizes[level], "text-[var(--ink)] font-display m-0")}>
      {props.text}
    </Tag>
  );
};

const Text = ({
  props,
}: RendererProps<{ text: string; tone?: "default" | "muted" }>) => (
  <p
    className={clsx(
      "text-[13.5px] leading-relaxed m-0",
      props.tone === "muted" ? "text-[var(--muted)]" : "text-[var(--ink-2)]",
    )}
  >
    {props.text}
  </p>
);

const Overline = ({ props }: RendererProps<{ text: string }>) => (
  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] font-medium">
    {props.text}
  </span>
);

const StockCardRenderer = ({ props }: RendererProps<{ ticker: string }>) => {
  const stock = getStock(props.ticker);
  if (!stock) {
    return (
      <div className="surface-soft px-3 py-2 text-[12px] text-[var(--muted)]">
        Unknown ticker: {props.ticker}
      </div>
    );
  }
  return <StockCard stock={stock} />;
};

function Slot({ render }: { render: ReactNode }) {
  return <>{render}</>;
}

export const renderers = {
  Stack,
  Row,
  Grid,
  Heading,
  Text,
  Overline,
  StockCard: StockCardRenderer,
};
