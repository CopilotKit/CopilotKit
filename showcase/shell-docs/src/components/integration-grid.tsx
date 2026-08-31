"use client";

import React from "react";
import { useFramework } from "./framework-provider";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

export function IntegrationGrid({
  path,
  description,
}: {
  path?: string;
  exclude?: string[];
  description?: string;
}) {
  const { framework } = useFramework();

  // On a framework-scoped route the user already chose a backend — hide.
  if (framework) return null;

  // Shell host is now read at runtime from window.__SHOWCASE_CONFIG__
  // (set by the root layout) so the rendered <a href> reflects the
  // current deploy's NEXT_PUBLIC_SHELL_URL without a rebuild. Pulled
  // after the early-return so we never call into the client reader on
  // renders that produce no DOM.
  const shellHost = getRuntimeConfig().shellUrl;

  return (
    <>
      <h2>Choose your AI backend</h2>
      {description && (
        <p className="mb-4 text-[var(--text-secondary)]">{description}</p>
      )}
      <div className="shell-docs-radius-surface mb-4 bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">
        See{" "}
        <a
          href={`${shellHost}/integrations`}
          className="text-[var(--accent)]"
          // shellHost is the SSR placeholder during server-render and the
          // real value post-hydration (runtime-config.client.ts). React
          // would otherwise log a hydration mismatch on this href every
          // pageload; suppression scopes to THIS attribute mismatch only.
          suppressHydrationWarning
        >
          Integrations
        </a>{" "}
        for all available frameworks{path ? ` (${path})` : ""}.
      </div>
    </>
  );
}
