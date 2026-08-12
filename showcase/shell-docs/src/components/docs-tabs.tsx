// <Tabs>/<Tab> — thin wrappers around Fumadocs's built-in tabs.
//
// Why a wrapper instead of re-exporting Fumadocs directly:
//
//   - Fumadocs's <Tabs items={[...]}> escapes each item via
//     `value.toLowerCase().replace(/\s/, "-")` to derive radix-tabs
//     `value` keys. Our authored MDX uses the literal label as the
//     <Tab value="...">, e.g. `<Tab value="JavaScript">` against
//     `<Tabs items={["JavaScript", "Python"]}>`. Fumadocs's Tab
//     component applies this same escapeValue internally, so we pass
//     the raw label — pre-escaping would double-escape multi-word
//     values and break the trigger↔content match for labels like
//     "JSON Configuration File" (two spaces → only first replaced →
//     residual space in trigger but not in double-escaped content).
//
//   - We accept `groupId` / `persist` / `default` props that the legacy
//     custom-Tabs MDX content was written against, so existing pages
//     don't need to be rewritten. `groupId` and `persist` are accepted
//     and currently ignored (Fumadocs's built-in tabs don't persist
//     cross-page state in this configuration); `default` is mapped to
//     Fumadocs's `defaultValue`.
//
// All other props (className, etc.) forward through to Fumadocs.

"use client";

import * as React from "react";
import {
  Tabs as FumadocsTabs,
  Tab as FumadocsTab,
} from "fumadocs-ui/components/tabs";
import type {
  TabsProps as FumadocsTabsProps,
  TabProps as FumadocsTabProps,
} from "fumadocs-ui/components/tabs";

/**
 * Mirror Fumadocs's internal `escapeValue` — keep this in sync with
 * `node_modules/fumadocs-ui/dist/components/tabs.js`. Used ONLY for
 * the `Tabs` defaultValue so the initial-selection value matches the
 * trigger values Fumadocs generates from `items`. Do NOT apply to
 * individual `Tab` values — Fumadocs's Tab component calls this
 * internally; pre-escaping here would double-escape and break the
 * trigger↔content pairing for multi-word labels.
 */
function escapeValue(v: string): string {
  return v.toLowerCase().replace(/\s/, "-");
}

interface ExtendedTabsProps extends Omit<FumadocsTabsProps, "defaultValue"> {
  /**
   * Initial active tab label. MDX authors write `default="Python"`
   * (legacy convention from when this component shimmed fumadocs);
   * we also accept Fumadocs's `defaultValue`.
   */
  default?: string;
  defaultValue?: string;
  /** Accepted for source compat — fumadocs persistent-tab feature. */
  groupId?: string;
  persist?: boolean;
}

type TabChildProps = {
  value?: unknown;
  title?: unknown;
};

function deriveItemsFromChildren(
  children: React.ReactNode,
): string[] | undefined {
  const items = React.Children.toArray(children)
    .map((child) => {
      if (!React.isValidElement<TabChildProps>(child)) {
        return undefined;
      }

      const value = child.props.value ?? child.props.title;
      return typeof value === "string" && value.length > 0 ? value : undefined;
    })
    .filter((value): value is string => Boolean(value));

  return items.length > 0 ? items : undefined;
}

export function Tabs({
  default: defaultProp,
  defaultValue,
  groupId: _groupId,
  persist: _persist,
  items: itemsProp,
  children,
  ...rest
}: ExtendedTabsProps) {
  const items = itemsProp ?? deriveItemsFromChildren(children);
  const resolvedDefault = defaultValue ?? defaultProp ?? items?.[0];

  return (
    <FumadocsTabs
      {...rest}
      items={items}
      defaultValue={resolvedDefault ? escapeValue(resolvedDefault) : undefined}
    >
      {children}
    </FumadocsTabs>
  );
}

interface ExtendedTabProps extends FumadocsTabProps {
  /** Legacy MDX prop — mirrors `value`. */
  title?: string;
}

export function Tab({ value, title, ...rest }: ExtendedTabProps) {
  // Pass the raw label to FumadocsTab — Fumadocs's Tab component
  // applies escapeValue internally to match the trigger's derived key.
  // Pre-escaping here would double-escape and corrupt multi-word labels
  // (e.g. "JSON Configuration File" → "json-configuration file" after
  // one pass, then "json-configuration-file" after the second pass,
  // which no longer matches the trigger's "json-configuration file").
  const resolved = value ?? title;
  return <FumadocsTab value={resolved} {...rest} />;
}
