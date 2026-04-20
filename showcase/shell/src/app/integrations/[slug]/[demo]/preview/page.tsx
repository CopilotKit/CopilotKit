"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Integration, Demo } from "@/lib/registry";

export default function StandalonePreviewPage() {
  const params = useParams<{ slug: string; demo: string }>();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [demo, setDemo] = useState<Demo | null>(null);

  useEffect(() => {
    import("@/data/registry.json").then((mod) => {
      const registry = mod.default as { integrations: Integration[] };
      const integ = registry.integrations.find((i) => i.slug === params.slug);
      if (integ) {
        setIntegration(integ);
        setDemo(integ.demos.find((d) => d.id === params.demo) ?? null);
      }
    });
  }, [params.slug, params.demo]);

  if (!integration || !demo) {
    return (
      <div className="flex h-[calc(100vh-52px)] items-center justify-center text-[var(--text-muted)]">
        Loading preview…
      </div>
    );
  }

  let localBackends: Record<string, string> = {};
  try {
    const raw = process.env.NEXT_PUBLIC_LOCAL_BACKENDS;
    if (raw) localBackends = JSON.parse(raw);
  } catch {}
  // Prefer a per-cell URL (its own container, route "/"). Fall back to the
  // per-integration container with the demo's sub-route.
  const cellKey = `${integration.slug}::${demo.id}`;
  const cellBase = localBackends[cellKey];
  const src = cellBase
    ? `${cellBase}/`
    : `${localBackends[integration.slug] ?? integration.backend_url}${demo.route}`;

  return (
    <div className="h-[calc(100vh-52px)] w-full">
      <iframe
        src={src}
        className="h-full w-full border-0"
        title={`${integration.name} — ${demo.name}`}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
