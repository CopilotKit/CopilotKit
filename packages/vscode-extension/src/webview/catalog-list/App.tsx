import { useEffect, useMemo, useState } from "react";
import type { DiscoveredComponent } from "../../extension/types";
import type {
  CatalogListToWebviewMessage,
  CatalogListFromWebviewMessage,
} from "../../extension/sidebar/catalog-list-bridge-types";
import { CatalogItem } from "./components/CatalogItem";
import { EmptyCatalogState } from "./components/EmptyCatalogState";

declare function acquireVsCodeApi(): {
  postMessage(msg: CatalogListFromWebviewMessage): void;
};

const vscode = acquireVsCodeApi();

export function App() {
  const [components, setComponents] = useState<DiscoveredComponent[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as CatalogListToWebviewMessage;
      switch (msg.type) {
        case "init":
          setWorkspaceRoot(msg.workspaceRoot);
          setInitialized(true);
          break;
        case "components":
          setComponents(msg.components);
          setInitialized(true);
          break;
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const sorted = useMemo(
    () => [...components].sort((a, b) => a.name.localeCompare(b.name)),
    [components],
  );

  const onPreview = (component: DiscoveredComponent, fixtureName?: string) =>
    vscode.postMessage({ type: "preview", component, fixtureName });
  const onOpenSource = (component: DiscoveredComponent, fixtureName?: string) =>
    vscode.postMessage({ type: "openSource", component, fixtureName });
  const onRefresh = () => vscode.postMessage({ type: "refresh" });

  return (
    <div className="flex flex-col h-full text-[13px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--vscode-panel-border)]">
        <div className="text-[11px] uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
          A2UI Catalog
        </div>
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh"
          aria-label="Refresh"
          className="text-[var(--vscode-icon-foreground,var(--vscode-foreground))] opacity-70 hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded px-1.5 py-0.5"
        >
          {"\u21BB"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {!initialized ? null : sorted.length === 0 ? (
          <EmptyCatalogState workspaceRoot={workspaceRoot} />
        ) : (
          <div className="pt-1 pb-3">
            {sorted.map((component) => (
              <CatalogItem
                key={component.filePath}
                component={component}
                workspaceRoot={workspaceRoot}
                onPreview={onPreview}
                onOpenSource={onOpenSource}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
