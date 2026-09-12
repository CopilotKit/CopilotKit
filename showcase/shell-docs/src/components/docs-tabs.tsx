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
//   - We implement cross-page persistence for `groupId` + `persist`.
//     Fumadocs's own tabs hold selection in local component state and
//     expose no persistence hook, so this wrapper takes over the
//     controlled `value`/`onValueChange`. The precedence for the initial
//     selection is:
//
//       1. `urlDefault` — the framework-route override the docs page
//          shell derives from the URL (see TAB_DEFAULTS_BY_SLUG). The
//          reader followed a `/langgraph-typescript/*` link, so the
//          TypeScript snippets must be the ones on screen.
//       2. A previously persisted pick for the same `groupId`.
//       3. The author's `default`/`defaultValue` written in the MDX.
//       4. The first item.
//
//     Keeping 1 and 3 as separate props matters: 45 of the 101 `persist`
//     tab groups in the content tree also carry an author `default=`, so
//     collapsing the two sources would make the stored pick unreachable
//     on almost half of the pages the feature exists for.
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
 * the `Tabs` value so it matches the trigger values Fumadocs generates
 * from `items`. Do NOT apply to individual `Tab` values — Fumadocs's
 * Tab component calls this internally; pre-escaping here would
 * double-escape and break the trigger↔content pairing for multi-word
 * labels.
 */
function escapeValue(v: string): string {
  return v.toLowerCase().replace(/\s/, "-");
}

function storageKeyFor(groupId: string): string {
  return `shell-docs.tab.${groupId}`;
}

interface ExtendedTabsProps extends Omit<FumadocsTabsProps, "defaultValue"> {
  /**
   * Initial active tab label. MDX authors write `default="Python"`
   * (legacy convention from when this component shimmed fumadocs);
   * we also accept Fumadocs's `defaultValue`. A persisted pick wins
   * over both — the author's default is only the cold-start choice.
   */
  default?: string;
  defaultValue?: string;
  /**
   * Framework-route override supplied by the docs page shell, not by
   * MDX. This one DOES win over a persisted pick: it reflects the URL
   * the reader followed.
   */
  urlDefault?: string;
  /** Groups tabs across pages so a `persist` pick carries over. */
  groupId?: string;
  /** Persist the active tab under `groupId` in localStorage. */
  persist?: boolean;
  /**
   * Controlled selection. Fumadocs's TabsProps omits these (it forwards
   * them to the Radix root untyped), so re-declare them here for our
   * persistence wiring.
   */
  value?: string;
  onValueChange?: (value: string) => void;
}

type TabChildProps = {
  value?: unknown;
  title?: unknown;
};

/**
 * Fumadocs's TabsProps type omits `value` / `onValueChange` even though
 * Fumadocs forwards them to the Radix root at runtime. Re-declare them
 * for our persistence wiring.
 */
type FumadocsTabsRuntimeProps = FumadocsTabsProps & {
  value?: string;
  onValueChange?: (value: string) => void;
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

function readStoredValue(storageKey: string | null): string | null {
  if (!storageKey) {
    return null;
  }
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    // Storage blocked (private mode, disabled cookies) — fall through.
    return null;
  }
}

function writeStoredValue(storageKey: string | null, value: string): void {
  if (!storageKey) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore quota / privacy-mode errors; persistence is best-effort.
  }
}

export function Tabs({
  default: defaultProp,
  defaultValue,
  urlDefault,
  groupId,
  persist: shouldPersist,
  items: itemsProp,
  children,
  ...rest
}: ExtendedTabsProps) {
  const items = itemsProp ?? deriveItemsFromChildren(children);
  const hasUrlDefault = Boolean(urlDefault);
  const resolvedDefault =
    urlDefault ?? defaultValue ?? defaultProp ?? items?.[0];
  const storageKey = groupId ? storageKeyFor(groupId) : null;
  const canPersist = Boolean(shouldPersist && groupId);

  const [active, setActive] = React.useState<string>(
    resolvedDefault ? escapeValue(resolvedDefault) : "",
  );

  React.useEffect(() => {
    // A URL-seeded override from the docs page shell always wins over a
    // stored pick. The author's MDX `default` does not — it is only the
    // cold-start choice for a reader who has never picked a tab.
    if (!canPersist || !items || hasUrlDefault) {
      return;
    }
    const stored = readStoredValue(storageKey);
    if (
      stored &&
      items.some((item) => escapeValue(item) === stored) &&
      stored !== active
    ) {
      setActive(stored);
    }
    // `hasUrlDefault` is fixed per render tree; `items` may be
    // re-derived each render, so guard via the equality checks above
    // rather than changing what the effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPersist, storageKey, items]);

  const handleValueChange = (value: string) => {
    if (items && !items.some((item) => escapeValue(item) === value)) {
      return;
    }
    setActive(value);
    if (canPersist) {
      writeStoredValue(storageKey, value);
    }
  };

  return (
    <FumadocsTabs
      {...({
        ...rest,
        items,
        value: active,
        onValueChange: handleValueChange,
      } as FumadocsTabsRuntimeProps)}
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
