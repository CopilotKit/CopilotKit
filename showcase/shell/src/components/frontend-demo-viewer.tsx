"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";

import { canonicalDemoPath } from "@/lib/frontend-route";
import type { ShowcaseCellResolution } from "@/lib/frontend-route";

interface FrontendOption {
  id: string;
  name: string;
}

type RunnableResolution = Extract<ShowcaseCellResolution, { kind: "runnable" }>;

/** Render a frontend-aware runnable cell with URL-owned frontend selection. */
export function FrontendDemoViewer({
  resolution,
  integration,
  feature,
  frontends,
}: {
  resolution: RunnableResolution;
  integration: string;
  feature: string;
  frontends: readonly FrontendOption[];
}) {
  const router = useRouter();
  const selectorId = useId();
  const basePath = canonicalDemoPath(
    resolution.frontend.id,
    integration,
    feature,
  );

  return (
    <div className="flex h-[calc(100vh-52px)] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium text-[var(--text)]">
            {resolution.featureName}
          </h1>
          <p className="truncate font-mono text-xs text-[var(--text-muted)]">
            {resolution.cellId}
          </p>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <label
            htmlFor={selectorId}
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            Frontend
          </label>
          <select
            id={selectorId}
            value={resolution.frontend.id}
            onChange={(event) => {
              router.push(
                canonicalDemoPath(event.target.value, integration, feature),
              );
            }}
            className="min-h-9 border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {frontends.map((frontend) => (
              <option key={frontend.id} value={frontend.id}>
                {frontend.name}
              </option>
            ))}
          </select>
          <nav aria-label="Demo views" className="flex items-center gap-1">
            <Link
              href={basePath}
              aria-current="page"
              className="min-h-9 px-3 py-2 text-xs font-medium text-[var(--text)] underline decoration-[var(--accent)] decoration-2 underline-offset-4"
            >
              Preview
            </Link>
            <Link
              href={`${basePath}/code`}
              className="min-h-9 px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Code
            </Link>
          </nav>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden border border-[var(--border)]">
        <iframe
          src={resolution.iframeUrl}
          className="h-full w-full border-0"
          title={`${resolution.frontend.name} ${resolution.integrationName} ${resolution.featureName} demo`}
          allow="clipboard-read; clipboard-write; microphone"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
