"use client";

// IntegrationGrid — inline backend picker rendered at the bottom of
// unscoped (framework-agnostic) docs feature pages. Each chip opens THE
// CURRENT PAGE scoped to that backend, reusing the same path rewriting
// as the sidebar's backend selector (backendPathForCurrentPath), so the
// reader keeps their place instead of being bounced to a landing page.
//
// Backends listed in `exclude` (authored per call site in MDX) are shown
// grayed out — the feature genuinely isn't available there. A stale or
// missing `exclude` is non-fatal: the framework-scoped route already
// renders a graceful "not available for <framework>" fallback.

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { DEFAULT_FRAMEWORK, useFramework } from "./framework-provider";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { backendPathForCurrentPath } from "@/lib/frontend-options";
import { getDocsMode, getIntegrations } from "@/lib/registry";

export function IntegrationGrid({
  exclude,
  description,
}: {
  /** Legacy authoring metadata; no longer rendered. */
  path?: string;
  /**
   * Backend slugs this page's feature is not available for. MUST be
   * authored as a comma-separated STRING (`exclude="agno, agent-spec"`):
   * the MDX pipeline (next-mdx-remote `blockJS`, on by default) strips
   * expression attributes like `exclude={[...]}` before they reach the
   * component, so array literals silently arrive as undefined. Arrays
   * are still accepted for direct TSX consumers.
   */
  exclude?: string[] | string;
  description?: string;
}) {
  const { framework, effectiveFramework, setStoredFramework } = useFramework();
  const pathname = usePathname() ?? "";
  const posthog = usePostHog();

  // On a framework-scoped route the user already chose a backend — hide.
  if (framework) return null;

  const integrations = getIntegrations()
    .filter((i) => getDocsMode(i.slug) !== "hidden")
    .slice()
    .sort((a, b) => {
      if (a.slug === "built-in-agent") return -1;
      if (b.slug === "built-in-agent") return 1;
      return compareByDisplayOrder(a.slug, b.slug);
    });
  const allSlugs = integrations.map((i) => i.slug);
  const excluded = new Set(
    (Array.isArray(exclude) ? exclude : (exclude?.split(",") ?? []))
      .map((slug) => slug.trim())
      .filter(Boolean),
  );

  function handleSelect(slug: string) {
    setStoredFramework(slug);
    try {
      posthog?.capture("docs.framework_selected", {
        framework: slug,
        from_path: pathname,
        source: "integration_grid",
      });
    } catch {
      // Swallow - analytics is fire-and-forget.
    }
  }

  const chipBase =
    "shell-docs-radius-control inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[13px] font-medium";

  return (
    <>
      <h2>Choose your AI backend</h2>
      <p className="mb-4 text-[var(--text-secondary)]">
        {description ?? "Open this page for the backend you're building with."}
      </p>
      <div className="not-prose mb-4 flex flex-wrap gap-2">
        {integrations.map((i) => {
          const isCurrent = i.slug === effectiveFramework;
          const name = i.slug === "built-in-agent" ? "CopilotKit" : i.name;
          if (excluded.has(i.slug)) {
            return (
              <span
                key={i.slug}
                title={`Not available for ${name} yet`}
                className={`${chipBase} cursor-not-allowed border-[var(--border)] bg-[var(--bg-elevated)]/40 text-[var(--text-muted)] opacity-60`}
              >
                <FrameworkLogo slug={i.slug} fallbackSrc={i.logo} size={15} />
                {name}
              </span>
            );
          }
          return (
            <Link
              key={i.slug}
              href={backendPathForCurrentPath(
                i.slug,
                pathname,
                allSlugs,
                DEFAULT_FRAMEWORK,
              )}
              aria-current={isCurrent ? "page" : undefined}
              onClick={() => handleSelect(i.slug)}
              className={`${chipBase} no-underline transition-colors ${
                isCurrent
                  ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text)]"
              }`}
            >
              <FrameworkLogo
                slug={i.slug}
                fallbackSrc={i.logo}
                size={15}
                className={isCurrent ? "text-[var(--accent)]" : undefined}
              />
              {name}
            </Link>
          );
        })}
      </div>
    </>
  );
}
