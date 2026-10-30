/**
 * Upgrades A2UI v0.9 surfaces written for the playground's first catalog to
 * A2UI v1.0 on the Gen UI 2.0 standard components.
 *
 * The v0.9 catalog had its own Column, Row, Grid, Card, Tabs, Divider,
 * Carousel, Text, Markdown, Image, Badge, List, Button and form inputs. In
 * v1.0 those names are the standard components, whose props differ: a Card
 * no longer takes `title`/`description`, Text headings are `Title`, a Badge
 * says `label` and `color`, gaps are numbers. Bindings become `{ "@path" }`
 * and actions become event props (`onClick`, `onAction`).
 *
 * Used to convert recordings made before the migration (scripts/upgrade-recordings.ts).
 * React-free, so the agent and scripts can import it.
 */
import type { A2UIComponentNode } from "@copilotkit/shared";

type Node = A2UIComponentNode;

/** `{ path }` bindings, at any depth, become `{ "@path" }`. */
export function upgradeBindings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeBindings);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length === 1 &&
    entries[0][0] === "path" &&
    typeof entries[0][1] === "string"
  )
    return { "@path": entries[0][1] };
  return Object.fromEntries(entries.map(([k, v]) => [k, upgradeBindings(v)]));
}

const GAP: Record<string, number> = { none: 0, xs: 1, sm: 2, md: 3, lg: 4 };
const TITLE_SIZE: Record<string, string> = {
  h1: "2xl",
  h2: "xl",
  h3: "lg",
  h4: "md",
  h5: "sm",
};
const TEXT_COLOR: Record<string, string> = {
  muted: "secondary",
  accent: "primary",
  positive: "success",
  negative: "danger",
};
const BADGE_COLOR: Record<string, string> = {
  default: "secondary",
  positive: "success",
  negative: "danger",
  warning: "warning",
  info: "info",
  accent: "discovery",
};
const ASPECT: Record<string, string> = {
  square: "1/1",
  video: "16/9",
  wide: "21/9",
};

const drop = <T extends Record<string, unknown>>(o: T, ...keys: string[]) =>
  Object.fromEntries(
    Object.entries(o).filter(([k, v]) => !keys.includes(k) && v !== undefined),
  );

/** One v0.9 node to one or more v1.0 nodes (a Card's title becomes its own Title node). */
function upgradeNode(raw: Node): Node[] {
  const n = upgradeBindings(raw) as Node;
  const { id } = n;
  switch (n.component) {
    case "Blueprint":
      // The stand-in frame takes only these props; old recordings carried the streaming component's props too.
      return [
        {
          id,
          component: "Blueprint",
          ...(n.of !== undefined ? { of: n.of } : {}),
          ...(n.h !== undefined ? { h: n.h } : {}),
          ...(n.state !== undefined ? { state: n.state } : {}),
        },
      ];
    case "Column":
    case "Row":
    case "Grid": {
      const out: Node = {
        ...drop(n, "gap", "wrap"),
        id,
        component: n.component,
      };
      if (typeof n.gap === "string" && n.gap in GAP) out.gap = GAP[n.gap];
      if (n.component === "Row")
        out.wrap = n.wrap === false ? "nowrap" : "wrap";
      return [out];
    }
    case "Card": {
      const extra: Node[] = [];
      const head: string[] = [];
      if (n.title !== undefined) {
        extra.push({
          id: `${id}-title`,
          component: "Title",
          size: "md",
          text: n.title,
        });
        head.push(`${id}-title`);
      }
      if (n.description !== undefined) {
        extra.push({
          id: `${id}-description`,
          component: "Caption",
          text: n.description,
        });
        head.push(`${id}-description`);
      }
      const body = [
        ...(typeof n.child === "string" ? [n.child] : []),
        ...(Array.isArray(n.children) ? (n.children as string[]) : []),
      ];
      const children = [
        ...head,
        ...body,
        ...(typeof n.footer === "string" ? [n.footer] : []),
      ];
      return [{ id, component: "Card", children }, ...extra];
    }
    case "Text": {
      const variant = String(n.variant ?? "body");
      const color = typeof n.tone === "string" ? TEXT_COLOR[n.tone] : undefined;
      if (variant in TITLE_SIZE)
        return [
          {
            id,
            component: "Title",
            text: n.text,
            size: TITLE_SIZE[variant],
            ...(color ? { color } : {}),
          },
        ];
      if (variant === "caption")
        return [
          {
            id,
            component: "Caption",
            text: n.text,
            ...(color ? { color } : {}),
          },
        ];
      return [
        { id, component: "Text", text: n.text, ...(color ? { color } : {}) },
      ];
    }
    case "Badge":
      return [
        {
          id,
          component: "Badge",
          label: n.text,
          ...(typeof n.tone === "string" ? { color: BADGE_COLOR[n.tone] } : {}),
          ...(n.variant ? { variant: n.variant } : {}),
        },
      ];
    case "Image": {
      const out: Node = {
        ...drop(n, "alt", "caption", "aspect"),
        id,
        component: "Image",
      };
      if (n.alt !== undefined) out.description = n.alt;
      if (typeof n.aspect === "string" && ASPECT[n.aspect])
        out.aspectRatio = ASPECT[n.aspect];
      return [out];
    }
    case "Divider":
      return [{ ...drop(n, "label"), id, component: "Divider" }];
    case "Carousel":
      return [
        {
          ...drop(n, "title"),
          id,
          component: "Carousel",
          ...(n.title !== undefined ? { label: n.title } : {}),
        },
      ];
    case "Button": {
      const out: Node = {
        ...drop(n, "action", "variant", "fullWidth"),
        id,
        component: "Button",
      };
      if (n.action !== undefined) out.onClick = n.action;
      if (n.fullWidth) out.block = true;
      const variant = String(n.variant ?? "default");
      if (variant === "primary") out.variant = "primary";
      else if (variant === "secondary") out.variant = "soft";
      else if (variant === "ghost" || variant === "borderless")
        out.variant = "borderless";
      else if (variant === "destructive") out.color = "danger";
      return [out];
    }
    case "TextField":
      return [{ ...drop(n, "hint"), id, component: "TextField" }];
    case "Textarea":
      return [{ ...n, id, component: "TextArea" }];
    case "CheckBox":
      return [{ ...drop(n, "description"), id, component: "CheckBox" }];
    case "RadioGroup":
      return [{ ...n, id, component: "RadioGroup", variant: "cards" }];
    default: {
      // The playground's own components: only the event prop changed name.
      if (n.action === undefined) return [n];
      const { action, ...rest } = n;
      return [{ ...rest, id, component: n.component, onAction: action }];
    }
  }
}

export function upgradeComponents(components: Node[]): Node[] {
  return components.flatMap(upgradeNode);
}
