// <WhenFrameworkHas> — server component that renders its children only
// when the active framework's manifest has a particular flag set to a
// particular value.
//
// Usage in MDX (gating per a2ui implementation pattern):
//
//   <WhenFrameworkHas flag="a2ui_pattern" equals="schema-loading">
//     ...prose + <Snippet region="backend-schema-json-load" />...
//   </WhenFrameworkHas>
//
// Behavior:
//   - If the framework is unknown, OR the flag is null/missing, OR the
//     value doesn't equal `equals`, render nothing.
//   - If matches, render `children` unchanged.
//
// `framework` defaults logic mirrors <Snippet>:
//   1. Explicit `framework` prop (highest priority — any page can override).
//   2. `defaultFramework` injected by the docs page renderer (see
//      docs-page-view.tsx) from the URL slug.
//
// This is a server component — gating happens at render time and the
// non-matching branches never reach the client. There is no client-side
// toggling.
//
// The list of supported flags is intentionally narrow and tied to fields
// declared on the `Integration` type in `lib/registry.ts`. Adding a new
// flag means: (a) declare the field on the manifest schema + Integration
// interface, (b) add it to `SupportedFlag` below.

import React from "react";
import { getIntegration } from "@/lib/registry";

/**
 * Manifest fields that `<WhenFrameworkHas>` can gate on. Keep this in
 * sync with the corresponding optional fields on `Integration` in
 * `lib/registry.ts` and the manifest schema in
 * `showcase/shared/manifest.schema.json`.
 */
type SupportedFlag = "a2ui_pattern" | "interrupt_pattern";

interface WhenFrameworkHasProps {
  /** Manifest field to read (e.g. `"a2ui_pattern"`). */
  flag: SupportedFlag;
  /**
   * Required value to match. Children render only when
   * `integration[flag] === equals`. Strict equality — null/undefined
   * never matches. Mutually exclusive with `absent`.
   */
  equals?: string;
  /**
   * Inverse mode: render children only when the flag is null/missing on
   * the active framework's manifest. Lets MDX pages declare a single
   * "fallback" branch for frameworks that don't implement a feature, so
   * gated pages don't collapse to an empty middle.
   *
   * Mutually exclusive with `equals`. Exactly one of `equals` / `absent`
   * must be provided.
   */
  absent?: boolean;
  /**
   * Integration slug (e.g. `langgraph-python`, `mastra`). Defaults to
   * `defaultFramework` injected by the page renderer.
   */
  framework?: string;
  /**
   * Threaded in by the docs renderer (see docs-page-view.tsx) — same
   * pattern as <Snippet>'s defaultFramework.
   */
  defaultFramework?: string;
  children?: React.ReactNode;
}

export function WhenFrameworkHas({
  flag,
  equals,
  absent,
  framework,
  defaultFramework,
  children,
}: WhenFrameworkHasProps) {
  const resolvedFramework = framework ?? defaultFramework;
  if (!resolvedFramework) return null;

  const integration = getIntegration(resolvedFramework);
  if (!integration) return null;

  // Index the integration with the flag name. The `Integration` type
  // already constrains supported flag fields; we cast through `unknown`
  // because TypeScript can't statically prove `flag` indexes a typed
  // field, but `SupportedFlag` keeps the lookup safe in practice.
  const value = (integration as unknown as Record<string, unknown>)[flag];

  // `absent` mode: render the fallback when the flag is null/missing.
  // Used by pages that gate per-framework variants and need a "doesn't
  // apply here" branch so non-matching frameworks see useful prose
  // instead of a collapsed page.
  if (absent) {
    if (value == null) return <>{children}</>;
    return null;
  }

  if (value == null) return null;
  if (equals === undefined) return null;
  if (value !== equals) return null;

  return <>{children}</>;
}
