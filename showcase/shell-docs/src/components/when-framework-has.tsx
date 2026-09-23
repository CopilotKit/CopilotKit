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
// Modes (exactly one per tag):
//   - `equals="Y"`: render when the flag strictly equals "Y".
//   - `absent`: render when the flag is null/missing.
//   - `noneOf="A B"`: render when the flag is null/missing or none of the
//     space-separated values. This is the fallback branch after a set of
//     `equals` branches, and the only fallback for `slug`.
//   An unknown framework or a malformed gate renders nothing.
//
// `framework` defaults logic mirrors <Snippet>:
//   1. Explicit `framework` prop (highest priority — any page can override).
//   2. `defaultFramework` injected by the docs page renderer (see
//      docs-page-view.tsx) from the URL slug.
//
// This is a server component — gating happens at render time and the
// non-matching branches never reach the client. There is no client-side
// toggling. The gate itself lives in `lib/framework-gate.ts`, which the TOC,
// raw Markdown, and the selected-guide guard evaluate too.
//
// The list of supported flags is intentionally narrow and tied to fields
// declared on the `Integration` type in `lib/registry.ts`. Adding a new
// flag means: (a) declare the field on the manifest schema + Integration
// interface, (b) add it to `FRAMEWORK_GATE_FLAGS` in `lib/framework-gate.ts`.

import React from "react";
import { frameworkGateMatches } from "@/lib/framework-gate";
import type { FrameworkGateFlag } from "@/lib/framework-gate";
import { getIntegration } from "@/lib/registry";

export interface WhenFrameworkHasProps {
  /** Manifest field to read (e.g. `"a2ui_pattern"`). */
  flag: FrameworkGateFlag;
  /**
   * Required value to match. Children render only when
   * `integration[flag] === equals`. Strict equality — null/undefined
   * never matches.
   */
  equals?: string;
  /**
   * Inverse mode: render children only when the flag is null/missing on
   * the active framework's manifest. Lets MDX pages declare a single
   * "fallback" branch for frameworks that don't implement a feature, so
   * gated pages don't collapse to an empty middle. Never matches for
   * always-set flags (`slug`, `language`); use `noneOf` there.
   */
  absent?: boolean;
  /**
   * Space-separated values. Render children when the flag is null/missing
   * or none of these, e.g. the fallback after per-`slug` branches.
   */
  noneOf?: string;
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
  noneOf,
  framework,
  defaultFramework,
  children,
}: WhenFrameworkHasProps) {
  const resolvedFramework = framework ?? defaultFramework;
  if (!resolvedFramework) return null;

  const integration = getIntegration(resolvedFramework);
  if (!frameworkGateMatches(integration, { flag, equals, absent, noneOf })) {
    return null;
  }
  return <>{children}</>;
}
