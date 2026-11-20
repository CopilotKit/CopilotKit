"use client";

/**
 * What every design system's components share: reading the engine's props, and what the standard Button
 * does besides its look (open a link, copy, submit a form or send its event to the agent; its A2UI
 * accessibility, its icon, its failed check), so a swapped button behaves like the one it replaces.
 */
import type { MouseEvent, ReactNode } from "react";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { iconFor } from "@/a2ui/catalog/renderers/data";
import { formatNumber } from "@/a2ui/catalog/renderers/format";

export const str = (v: unknown): string =>
  v == null || typeof v === "object" ? "" : String(v);

export const valueText = (v: unknown) =>
  typeof v === "number" ? formatNumber(v) : str(v);

/** "up", "down" or "flat": the model's trend, else the sign of the delta. */
export function trendOf(delta?: string, trend?: string) {
  if (trend === "up" || trend === "down" || trend === "flat") return trend;
  if (!delta) return "flat";
  return delta.trim().startsWith("-") || delta.trim().startsWith("−")
    ? "down"
    : "up";
}

/** Engine props of a standard component this layer reads; the rest pass through untouched. */
export type StandardProps = Record<string, unknown> & {
  children?: ReactNode;
  child?: ReactNode;
};

type Check = {
  message?: string;
  condition?:
    | boolean
    | { valid?: boolean; severity?: string; message?: string }
    | null;
};

/** The first failed check, an error before a warning, as the standard Button reads them. */
function failedCheck(checks: unknown) {
  if (!Array.isArray(checks)) return undefined;
  let first: { message: string; blocks: boolean } | undefined;
  for (const { condition, message } of checks as Check[]) {
    if (condition == null) continue;
    const failed =
      typeof condition === "boolean"
        ? condition
          ? undefined
          : { message: message ?? "Invalid value", blocks: true }
        : condition.valid
          ? undefined
          : {
              message: message ?? condition.message ?? "Invalid value",
              blocks: (condition.severity ?? "error") === "error",
            };
    if (failed?.blocks) return failed;
    first ??= failed;
  }
  return first;
}

/** The standard Button's click: a link or a copy stays in the browser; anything else is the model's event. */
export function pressButton(
  props: StandardProps,
  event: MouseEvent<HTMLButtonElement>,
) {
  event.stopPropagation();
  if (props.submit && event.currentTarget.form !== null) return;
  const href = typeof props.href === "string" ? props.href.trim() : "";
  if (href) {
    if (/^(https?:|mailto:)/i.test(href))
      window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  if (typeof props.copy === "string" && props.copy) {
    void navigator.clipboard?.writeText(props.copy).catch(() => {});
    return;
  }
  const onClick = props.onClick as ((args: object) => unknown) | undefined;
  void onClick?.({});
}

/**
 * Everything a swapped Button needs besides its classes: its content (the icon, then the label), the
 * model's accessibility attributes, a name when it shows only an icon, the failed check as its tooltip,
 * and whether that check (or `disabled`, `loading`) holds it back.
 */
export function useButton(props: StandardProps) {
  const aria = useGenerativeUIAccessibility();
  const label = props.children ?? props.child ?? str(props.label ?? props.text);
  const Icon = iconFor(str(props.icon));
  const check = failedCheck(props.checks);
  const icon = Icon ? <Icon aria-hidden className="size-4" /> : null;
  return {
    content: (
      <>
        {icon}
        {label}
      </>
    ),
    /** The two parts of `content`, for a button that places its icon itself. */
    icon,
    label,
    attributes: {
      ...aria,
      "aria-label":
        aria["aria-label"] ?? (!label && Icon ? str(props.icon) : undefined),
      "aria-busy": props.loading ? true : undefined,
      title: check?.message,
      disabled: Boolean(props.disabled || props.loading || check?.blocks),
      type: (props.submit ? "submit" : "button") as "submit" | "button",
      onClick: (e: MouseEvent<HTMLButtonElement>) => pressButton(props, e),
    },
  };
}
