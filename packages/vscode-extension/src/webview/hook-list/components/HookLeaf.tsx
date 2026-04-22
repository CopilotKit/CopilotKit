import React from "react";
import type { HookCallSite } from "../../../extension/hooks/hook-scanner";
import type { HookTreeStatus } from "../../../extension/hooks/tree-model";

interface Props {
  site: HookCallSite;
  category: "render" | "data";
  status: HookTreeStatus;
  workspaceRoot: string | null;
  onPreview(site: HookCallSite): void;
  onOpenSource(site: HookCallSite): void;
}

/**
 * Renders the status badge symbol + color. Matches the meaning in the tree
 * provider: pass (captured), warning (not-captured), error (mount-error),
 * neutral (unknown).
 */
function statusBadge(status: HookTreeStatus): {
  char: string;
  color: string;
  title: string;
} {
  switch (status) {
    case "captured":
      return {
        char: "\u2713",
        color: "var(--vscode-testing-iconPassed, var(--vscode-charts-green))",
        title: "Captured",
      };
    case "not-captured":
      return {
        char: "\u26A0",
        color: "var(--vscode-editorWarning-foreground)",
        title: "Not captured",
      };
    case "mount-error":
      return {
        char: "\u2715",
        color: "var(--vscode-editorError-foreground)",
        title: "Mount error",
      };
    default:
      return {
        char: "\u00B7",
        color: "var(--vscode-descriptionForeground)",
        title: "No status yet",
      };
  }
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

export function HookLeaf({
  site,
  category,
  status,
  workspaceRoot,
  onPreview,
  onOpenSource,
}: Props) {
  const badge = statusBadge(status);
  const label = site.name ?? `line:${site.loc.line}`;
  const location = `${relativize(site.filePath, workspaceRoot)}:${site.loc.line}`;

  // Render-category rows are clickable for preview; the "go to source"
  // button is the escape hatch. Data-category rows have no preview and
  // fall back to opening source on click so they're still useful.
  const isRenderable = category === "render";
  const rowTitle = isRenderable
    ? `Click to preview \u2014 ${site.hook} \u2022 ${label} \u2022 ${site.filePath}:${site.loc.line}`
    : `Click to open source \u2014 ${site.hook} \u2022 ${label} \u2022 ${site.filePath}:${site.loc.line}`;

  return (
    <div
      className="group flex items-center gap-2 pl-7 pr-2 py-1 hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer"
      onClick={() => (isRenderable ? onPreview(site) : onOpenSource(site))}
      title={rowTitle}
    >
      <span
        aria-label={badge.title}
        title={badge.title}
        className="w-3 text-center text-[11px]"
        style={{ color: badge.color }}
      >
        {badge.char}
      </span>
      <span className="truncate text-[var(--vscode-textLink-foreground)]">
        {label}
      </span>
      <span className="truncate text-[11px] text-[var(--vscode-descriptionForeground)]">
        {location}
      </span>
      {isRenderable && (
        <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSource(site);
            }}
            title="Go to source"
            aria-label="Go to source"
            className="font-mono text-[11px] leading-none px-1.5 py-0.5 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
          >
            {"</>"}
          </button>
        </span>
      )}
    </div>
  );
}
