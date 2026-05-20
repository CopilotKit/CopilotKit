// <Tabs>/<Tab> — thin wrappers around Fumadocs's built-in tabs.
//
// Why a wrapper instead of re-exporting Fumadocs directly:
//
//   - Fumadocs's <Tabs items={[...]}> escapes each item via
//     `value.toLowerCase().replace(/\s/, "-")` to derive radix-tabs
//     `value` keys. Our authored MDX uses the literal label as the
//     <Tab value="...">, e.g. `<Tab value="JavaScript">` against
//     `<Tabs items={["JavaScript", "Python"]}>`. Without escaping the
//     Tab's value to match, radix can't pair the trigger with the
//     content and the tab body never renders.
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
  type TabsProps as FumadocsTabsProps,
  type TabProps as FumadocsTabProps,
} from "fumadocs-ui/components/tabs";

/**
 * Mirror Fumadocs's internal `escapeValue` — keep this in sync with
 * `node_modules/fumadocs-ui/dist/components/tabs.js`. Used so a Tab's
 * authored `value="JavaScript"` resolves to the same key Fumadocs
 * derives from the Tabs's `items` array.
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

export function Tabs({
  default: defaultProp,
  defaultValue,
  groupId: _groupId,
  persist: _persist,
  ...rest
}: ExtendedTabsProps) {
  const resolvedDefault = defaultValue ?? defaultProp;
  return (
    <FumadocsTabs
      {...rest}
      defaultValue={resolvedDefault ? escapeValue(resolvedDefault) : undefined}
    />
  );
}

interface ExtendedTabProps extends FumadocsTabProps {
  /** Legacy MDX prop — mirrors `value`. */
  title?: string;
}

export function Tab({ value, title, ...rest }: ExtendedTabProps) {
  // Authored MDX passes the literal label as `value`. Escape so it
  // matches Fumadocs's derivation from `<Tabs items={[...]}>`.
  const resolved = value ?? title;
  return (
    <FumadocsTab
      value={resolved ? escapeValue(resolved) : undefined}
      {...rest}
    />
  );
}
