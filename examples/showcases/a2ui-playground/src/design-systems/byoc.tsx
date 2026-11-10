"use client";

/**
 * Bring your own components: a small in-house design system, written as plain React and its own
 * stylesheet (`byoc-*` in design-systems.css), with no shadcn or Tailwind. Mapping it onto the catalog is
 * all it takes: each component takes the props of the catalog component it stands for. Only leaves are
 * swapped; containers (Card, Section) and everything else keep their implementation, themed to match,
 * so switching never remounts what a visitor typed or picked inside them.
 */
import type { ReactNode } from "react";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { asArray } from "@/a2ui/catalog/renderers/format";
import type { RendererMap } from "@/a2ui/catalog/renderers/types";
import {
  str,
  trendOf,
  useButton,
  valueText,
  type StandardProps,
} from "./shared";

function Delta({ delta, trend }: { delta?: string; trend?: string }) {
  if (!delta) return null;
  return (
    <span className="byoc-delta" data-trend={trendOf(delta, trend)}>
      {delta}
    </span>
  );
}

const BUTTON_KIND: Record<string, string> = {
  primary: "primary",
  solid: "primary",
  borderless: "quiet",
  ghost: "quiet",
};

function ByocTag(p: StandardProps) {
  const aria = useGenerativeUIAccessibility();
  return (
    <span {...aria} className="byoc-tag" data-tone={str(p.color) || "neutral"}>
      {str(p.label)}
    </span>
  );
}

function ByocButton(p: StandardProps) {
  const { content, attributes } = useButton(p);
  return (
    <button
      {...attributes}
      className="byoc-button"
      data-kind={
        p.color === "danger"
          ? "danger"
          : (BUTTON_KIND[str(p.variant)] ?? "secondary")
      }
      data-block={p.block || undefined}
    >
      {content}
    </button>
  );
}

export const byocStandard: Record<string, (p: StandardProps) => ReactNode> = {
  Badge: ByocTag,
  Button: ByocButton,
  Divider: (p) => (
    <hr className="byoc-rule" data-axis={p.axis === "vertical" ? "y" : "x"} />
  ),
};

type Own =
  | "Stat"
  | "StatGroup"
  | "KeyValueList"
  | "Heading"
  | "Alert"
  | "Callout"
  | "Progress";

export const byocOwn: Partial<RendererMap<Own>> = {
  Stat: ({ props }) => (
    <div className="byoc-metric">
      <span className="byoc-metric-label">{str(props.label)}</span>
      <span className="byoc-metric-value">{valueText(props.value)}</span>
      <Delta delta={props.delta} trend={props.trend} />
      {props.caption ? (
        <span className="byoc-note">{props.caption}</span>
      ) : null}
    </div>
  ),
  StatGroup: ({ props }) => (
    <div className="byoc-metrics">
      {asArray<Record<string, unknown>>(props.items).map((it, i) => (
        <div key={i} className="byoc-metric">
          <span className="byoc-metric-label">{str(it.label)}</span>
          <span className="byoc-metric-value">{valueText(it.value)}</span>
          <Delta delta={str(it.delta)} trend={str(it.trend)} />
        </div>
      ))}
    </div>
  ),
  KeyValueList: ({ props }) => (
    <div className="byoc-panel">
      {props.title ? <h4 className="byoc-panel-title">{props.title}</h4> : null}
      <dl className="byoc-pairs">
        {asArray<{ label?: string; value?: unknown; hint?: string }>(
          props.items,
        ).map((it, i) => (
          <div key={i}>
            <dt>{str(it.label)}</dt>
            <dd>
              {valueText(it.value)}
              {it.hint ? <small>{it.hint}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  ),
  Heading: ({ props }) => (
    <header className="byoc-heading" data-level={props.level ?? "2"}>
      {props.eyebrow ? (
        <span className="byoc-eyebrow">{props.eyebrow}</span>
      ) : null}
      <h2>{props.text}</h2>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  Alert: ({ props }) => (
    <div
      className="byoc-banner"
      data-tone={props.tone ?? "info"}
      role={props.tone === "error" ? "alert" : "status"}
    >
      {props.title ? <strong>{props.title}</strong> : null}
      <span>{props.message}</span>
    </div>
  ),
  Callout: ({ props }) => (
    <div className="byoc-banner" data-tone="info">
      {props.title ? <strong>{props.title}</strong> : null}
      <span>{props.text}</span>
      {props.actionLabel && props.action ? (
        <button
          type="button"
          className="byoc-button"
          data-kind="secondary"
          onClick={props.action}
        >
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  ),
  Progress: ({ props }) => {
    const pct = Math.max(0, Math.min(100, props.value));
    return (
      <div className="byoc-progress">
        <div className="byoc-progress-head">
          <span>{props.label}</span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div
          className="byoc-progress-track"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={props.label}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        {props.caption ? (
          <span className="byoc-note">{props.caption}</span>
        ) : null}
      </div>
    );
  },
};
