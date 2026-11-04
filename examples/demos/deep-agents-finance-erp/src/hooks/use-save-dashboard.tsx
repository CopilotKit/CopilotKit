"use client";

import { useEffect } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";
import { useDashboard } from "@/context/dashboard-context";
import { CompletedToolCard } from "@/components/chat/tool-card";

const processedSaveKeys = new Set<string>();
const processedLoadKeys = new Set<string>();

function SaveHandler({
  name,
  status,
  result,
}: {
  name: string;
  status: string;
  result?: unknown;
}) {
  const { saveCurrent } = useDashboard();

  useEffect(() => {
    if (status !== ToolCallStatus.Complete) return;
    const key = `save-${name}`;
    if (processedSaveKeys.has(key)) return;
    processedSaveKeys.add(key);
    queueMicrotask(() => {
      saveCurrent(name);
    });
  }, [status, name, saveCurrent]);

  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="save_dashboard"
        args={{ name }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Saving dashboard...
    </p>
  );
}

function LoadHandler({
  name,
  status,
  result,
}: {
  name: string;
  status: string;
  result?: unknown;
}) {
  const { loadSavedByName } = useDashboard();

  useEffect(() => {
    if (status !== ToolCallStatus.Complete) return;
    const key = `load-${name}`;
    if (processedLoadKeys.has(key)) return;
    processedLoadKeys.add(key);
    queueMicrotask(() => {
      loadSavedByName(name);
    });
  }, [status, name, loadSavedByName]);

  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="load_dashboard"
        args={{ name }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Loading dashboard...
    </p>
  );
}

export function useSaveDashboard() {
  useRenderTool(
    {
      name: "save_dashboard",
      render: ({ args, status, result }) => (
        <SaveHandler name={args?.name ?? ""} status={status} result={result} />
      ),
    },
    [],
  );

  useRenderTool(
    {
      name: "load_dashboard",
      render: ({ args, status, result }) => (
        <LoadHandler name={args?.name ?? ""} status={status} result={result} />
      ),
    },
    [],
  );
}
