import { useState } from "react";
import type { DiscoveredComponent } from "../../../extension/types";

interface Props {
  component: DiscoveredComponent;
  workspaceRoot: string | null;
  onPreview(component: DiscoveredComponent, fixtureName?: string): void;
  onOpenSource(component: DiscoveredComponent, fixtureName?: string): void;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function relativize(p: string, root: string | null): string {
  if (!root) return basename(p);
  const normRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normPath = p.replace(/\\/g, "/");
  if (normPath.startsWith(normRoot + "/")) {
    return normPath.slice(normRoot.length + 1);
  }
  return basename(p);
}

export function CatalogItem({
  component,
  workspaceRoot,
  onPreview,
  onOpenSource,
}: Props) {
  const fixtures = component.fixtureNames ?? [];
  const hasFixtures = fixtures.length > 0;
  const [expanded, setExpanded] = useState(false);
  const location = relativize(component.filePath, workspaceRoot);

  return (
    <div>
      <div
        className="group flex items-center gap-2 pl-3 pr-2 py-1 hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer"
        onClick={() => {
          if (hasFixtures) {
            setExpanded((v) => !v);
          } else {
            onPreview(component);
          }
        }}
        title={
          hasFixtures
            ? `Click to ${expanded ? "collapse" : "expand"} fixtures \u2014 ${component.name}`
            : `Click to preview \u2014 ${component.name}`
        }
      >
        <span
          aria-hidden
          className="w-3 text-center text-[11px] text-[var(--vscode-descriptionForeground)]"
        >
          {hasFixtures ? (expanded ? "\u25BE" : "\u25B8") : "\u00B7"}
        </span>
        <span className="truncate font-medium text-[var(--vscode-textLink-foreground)]">
          {component.name}
        </span>
        <span className="truncate text-[11px] text-[var(--vscode-descriptionForeground)]">
          {location}
        </span>
        {!component.fixturePath ? (
          <span className="shrink-0 rounded-sm bg-[var(--vscode-badge-background)] px-1.5 text-[10px] text-[var(--vscode-badge-foreground)]">
            auto
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!hasFixtures && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(component);
              }}
              title="Preview component"
              aria-label="Preview component"
              className="text-[11px] leading-none px-1.5 py-0.5 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
            >
              {"\u25B7"}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSource(component);
            }}
            title="Go to source"
            aria-label="Go to source"
            className="font-mono text-[11px] leading-none px-1.5 py-0.5 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
          >
            {"</>"}
          </button>
        </span>
      </div>

      {hasFixtures && expanded ? (
        <div>
          {fixtures.map((name) => (
            <FixtureRow
              key={name}
              fixtureName={name}
              component={component}
              onPreview={onPreview}
              onOpenSource={onOpenSource}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FixtureRow({
  fixtureName,
  component,
  onPreview,
  onOpenSource,
}: {
  fixtureName: string;
  component: DiscoveredComponent;
  onPreview(component: DiscoveredComponent, fixtureName?: string): void;
  onOpenSource(component: DiscoveredComponent, fixtureName?: string): void;
}) {
  return (
    <div
      className="group flex items-center gap-2 pl-7 pr-2 py-1 hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer"
      onClick={() => onPreview(component, fixtureName)}
      title={`Click to preview fixture \u2014 ${fixtureName}`}
    >
      <span
        aria-hidden
        className="w-3 text-center text-[11px] text-[var(--vscode-descriptionForeground)]"
      >
        {"\u25E6"}
      </span>
      <span className="truncate text-[var(--vscode-textLink-foreground)]">
        {fixtureName}
      </span>
      <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSource(component, fixtureName);
          }}
          title="Go to fixture source"
          aria-label="Go to fixture source"
          className="font-mono text-[11px] leading-none px-1.5 py-0.5 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
        >
          {"</>"}
        </button>
      </span>
    </div>
  );
}
