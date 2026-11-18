"use client";

import { useEffect } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";
import { useRouter } from "next/navigation";
import { CompletedToolCard } from "@/components/chat/tool-card";

const routes: Record<string, string> = {
  dashboard: "/",
  invoices: "/invoices",
  accounts: "/accounts",
  inventory: "/inventory",
  hr: "/hr",
};

// Module-level dedup set — survives component remounts (issue #04)
const processedKeys = new Set<string>();

function Navigator({
  page,
  filter,
  status,
  result,
}: {
  page: string;
  filter?: string;
  status: string;
  result?: unknown;
}) {
  const router = useRouter();

  useEffect(() => {
    if (status !== ToolCallStatus.Complete || !page) return;

    const key = `navigate_and_filter-${page}-${filter || ""}`;
    if (processedKeys.has(key)) return;
    processedKeys.add(key);

    queueMicrotask(() => {
      const base = routes[page] ?? "/";
      const url = filter
        ? `${base}?filter=${encodeURIComponent(filter)}`
        : base;
      router.push(url);
    });
  }, [status, page, filter, router]);

  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="navigate_and_filter"
        args={{ page, filter }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Navigating to {page}...
    </p>
  );
}

export function useNavigateAndFilter() {
  useRenderTool(
    {
      name: "navigate_and_filter",
      render: ({ args, status, result }) => (
        <Navigator
          page={args?.page ?? ""}
          filter={args?.filter}
          status={status}
          result={result}
        />
      ),
    },
    [],
  );
}
