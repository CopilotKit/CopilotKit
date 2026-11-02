"use client";

/**
 * Material: the catalog drawn with Material 3 Expressive (`@language-lit/material3-expressive`), in a dark
 * Material color scheme generated from one seed (design-systems.css). Its stylesheet and Roboto Flex load
 * the first time Material is picked (`./material-assets`). As with the others, only leaves are swapped:
 * containers keep their implementation and take Material's colors and corners from the theme, so
 * switching never remounts what is inside them.
 */
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import {
  Button,
  Card,
  Divider,
  IconButton,
  LinearProgress,
  Text,
  type ButtonVariant,
  type IconButtonVariant,
} from "@language-lit/material3-expressive";
import { asArray } from "@/a2ui/catalog/renderers/format";
import type { RendererMap } from "@/a2ui/catalog/renderers/types";
import {
  str,
  trendOf,
  useButton,
  valueText,
  type StandardProps,
} from "./shared";

/** The standard Button's variants as Material's emphasis levels; anything else is outlined. */
const BUTTON_VARIANT: Record<string, ButtonVariant> = {
  primary: "filled",
  solid: "filled",
  soft: "tonal",
  borderless: "text",
  ghost: "text",
};

const ICON_BUTTON_VARIANT: Record<ButtonVariant, IconButtonVariant> = {
  filled: "filled",
  tonal: "tonal",
  outlined: "outlined",
  elevated: "tonal",
  text: "standard",
};

function MaterialButton(p: StandardProps) {
  const { icon, label, attributes } = useButton(p);
  const variant = BUTTON_VARIANT[str(p.variant)] ?? "outlined";
  const size = p.size === "sm" || p.size === "xs" ? "extra-small" : "small";
  // Material has no danger button: a danger one keeps its emphasis and takes the error roles (design-systems.css).
  const danger = p.color === "danger" || undefined;
  if (!label && icon) {
    return (
      <IconButton
        {...attributes}
        variant={ICON_BUTTON_VARIANT[variant]}
        size={size}
        data-danger={danger}
      >
        {icon}
      </IconButton>
    );
  }
  return (
    <Button
      {...attributes}
      variant={variant}
      size={size}
      width={p.block ? "full" : "fit"}
      leadingIcon={icon ?? undefined}
      data-danger={danger}
    >
      {label}
    </Button>
  );
}

/**
 * Material's Badge is a count of four characters at most, so a status label is drawn as Material text on
 * a tonal container instead, in the color role of its tone.
 */
function MaterialLabel(p: StandardProps) {
  const aria = useGenerativeUIAccessibility();
  return (
    <Text
      {...aria}
      variant="labelMedium"
      className="md-label"
      data-tone={str(p.color) || "neutral"}
      data-variant={str(p.variant) || undefined}
    >
      {str(p.label)}
    </Text>
  );
}

export const materialStandard: Record<string, (p: StandardProps) => ReactNode> =
  {
    Badge: MaterialLabel,
    Button: MaterialButton,
    Divider: (p) => (
      <Divider
        orientation={p.axis === "vertical" ? "vertical" : "horizontal"}
      />
    ),
  };

function Delta({ delta, trend }: { delta?: string; trend?: string }) {
  if (!delta) return null;
  const t = trendOf(delta, trend);
  const Icon =
    t === "down" ? ArrowDownRight : t === "flat" ? Minus : ArrowUpRight;
  return (
    <Text variant="labelLarge" className="md-delta" data-trend={t}>
      <Icon aria-hidden className="size-4" />
      {delta}
    </Text>
  );
}

function StatCard({
  label,
  value,
  delta,
  trend,
  caption,
}: {
  label: string;
  value: unknown;
  delta?: string;
  trend?: string;
  caption?: string;
}) {
  return (
    <Card as="div" variant="filled" className="md-stat">
      <Text variant="labelLarge" className="md-muted">
        {label}
      </Text>
      <Text variant="headlineMedium" className="md-value">
        {valueText(value)}
      </Text>
      <div className="md-row">
        <Delta delta={delta} trend={trend} />
        {caption ? (
          <Text variant="bodySmall" className="md-muted">
            {caption}
          </Text>
        ) : null}
      </div>
    </Card>
  );
}

type Own =
  | "Stat"
  | "StatGroup"
  | "KeyValueList"
  | "Heading"
  | "Alert"
  | "Callout"
  | "Progress";

const HEADING: Record<
  string,
  "headlineLarge" | "headlineSmall" | "titleLarge"
> = { "1": "headlineLarge", "2": "headlineSmall", "3": "titleLarge" };

export const materialOwn: Partial<RendererMap<Own>> = {
  Stat: ({ props }) => (
    <StatCard
      label={str(props.label)}
      value={props.value}
      delta={props.delta}
      trend={props.trend}
      caption={props.caption}
    />
  ),
  StatGroup: ({ props }) => (
    <div className="md-stats">
      {asArray<Record<string, unknown>>(props.items).map((it, i) => (
        <StatCard
          key={i}
          label={str(it.label)}
          value={it.value}
          delta={str(it.delta) || undefined}
          trend={str(it.trend) || undefined}
        />
      ))}
    </div>
  ),
  KeyValueList: ({ props }) => (
    <Card as="div" variant="outlined" className="md-panel">
      {props.title ? (
        <Text as="h4" variant="titleMedium">
          {props.title}
        </Text>
      ) : null}
      <dl className="md-pairs">
        {asArray<{ label?: string; value?: unknown; hint?: string }>(
          props.items,
        ).map((it, i) => (
          <div key={i}>
            <dt>
              <Text variant="bodyMedium" className="md-muted">
                {str(it.label)}
              </Text>
            </dt>
            <dd>
              <Text variant="bodyMedium">{valueText(it.value)}</Text>
              {it.hint ? (
                <Text variant="bodySmall" className="md-muted md-block">
                  {it.hint}
                </Text>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  ),
  Heading: ({ props }) => (
    <header className="md-heading">
      {props.eyebrow ? (
        <Text variant="labelLarge" className="md-eyebrow">
          {props.eyebrow}
        </Text>
      ) : null}
      <Text as="h2" variant={HEADING[props.level ?? "2"] ?? "headlineSmall"}>
        {props.text}
      </Text>
      {props.subtitle ? (
        <Text as="p" variant="bodyMedium" className="md-muted">
          {props.subtitle}
        </Text>
      ) : null}
    </header>
  ),
  Alert: ({ props }) => (
    <div
      className="md-banner"
      data-tone={props.tone ?? "info"}
      role={props.tone === "error" ? "alert" : "status"}
    >
      {props.title ? (
        <Text variant="titleSmall" className="md-block">
          {props.title}
        </Text>
      ) : null}
      {props.message ? (
        <Text variant="bodyMedium" className="md-block">
          {props.message}
        </Text>
      ) : null}
    </div>
  ),
  Callout: ({ props }) => (
    <div className="md-banner" data-tone="neutral">
      {props.title ? (
        <Text variant="titleSmall" className="md-block">
          {props.title}
        </Text>
      ) : null}
      <Text variant="bodyMedium" className="md-block">
        {props.text}
      </Text>
      {props.actionLabel && props.action ? (
        <Button variant="tonal" size="extra-small" onClick={props.action}>
          {props.actionLabel}
        </Button>
      ) : null}
    </div>
  ),
  Progress: ({ props }) => {
    const pct = Math.max(0, Math.min(100, props.value));
    return (
      <div className="md-progress" data-tone={props.tone}>
        <div className="md-row md-between">
          <Text variant="labelLarge">{props.label}</Text>
          <Text variant="labelLarge" className="md-muted">
            {Math.round(pct)}%
          </Text>
        </div>
        <LinearProgress value={pct} max={100} aria-label={props.label} />
        {props.caption ? (
          <Text variant="bodySmall" className="md-muted">
            {props.caption}
          </Text>
        ) : null}
      </div>
    );
  },
};
