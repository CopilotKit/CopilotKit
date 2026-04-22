import React, { useEffect, useMemo, useState } from "react";
import type {
  HookListToWebviewMessage,
  HookListFromWebviewMessage,
} from "../../extension/hooks/hook-list-bridge-types";
import type { HookCallSite } from "../../extension/hooks/hook-scanner";
import {
  groupSitesByHook,
  statusKeyForSite,
  type HookTreeStatus,
} from "../../extension/hooks/tree-model";
import { HookSection } from "./components/HookSection";
import { AvailableHooks } from "./components/AvailableHooks";
import { EmptyState } from "./components/EmptyState";

declare function acquireVsCodeApi(): {
  postMessage(msg: HookListFromWebviewMessage): void;
};

const vscode = acquireVsCodeApi();

export function App() {
  const [sites, setSites] = useState<HookCallSite[]>([]);
  const [statuses, setStatuses] = useState<Record<string, HookTreeStatus>>({});
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as HookListToWebviewMessage;
      switch (msg.type) {
        case "init":
          setWorkspaceRoot(msg.workspaceRoot);
          setInitialized(true);
          break;
        case "sites":
          setSites(msg.sites);
          setStatuses(msg.statuses);
          setInitialized(true);
          break;
        case "status": {
          const key = statusKeyForSite(msg.site);
          setStatuses((prev) => ({ ...prev, [key]: msg.status }));
          break;
        }
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const grouped = useMemo(() => groupSitesByHook(sites), [sites]);

  const onPreview = (site: HookCallSite) =>
    vscode.postMessage({ type: "preview", site });
  const onOpenSource = (site: HookCallSite) =>
    vscode.postMessage({ type: "openSource", site });
  // Refresh goes through the native VS Code title-bar icon (registered
  // via `view/title` → `copilotkit.hooks.refresh` in package.json),
  // which calls `doScan` in the extension host directly — no in-webview
  // button needed.

  const hasRegistered = grouped.registered.length > 0;

  return (
    <div className="flex flex-col h-full text-[13px]">
      <div className="flex-1 min-h-0 overflow-auto">
        {initialized && !hasRegistered ? (
          <EmptyState workspaceRoot={workspaceRoot} />
        ) : (
          <div className="pt-1 pb-3">
            {grouped.registered.map((group) => (
              <HookSection
                key={group.hook}
                group={group}
                statuses={statuses}
                workspaceRoot={workspaceRoot}
                onPreview={onPreview}
                onOpenSource={onOpenSource}
              />
            ))}
          </div>
        )}

        {initialized && grouped.available.length > 0 && (
          <AvailableHooks available={grouped.available} />
        )}
      </div>
    </div>
  );
}
