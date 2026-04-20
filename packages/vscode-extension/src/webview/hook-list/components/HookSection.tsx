import React, { useState } from "react";
import type { HookCallSite } from "../../../extension/hooks/hook-scanner";
import type {
  HookGroup,
  HookTreeStatus,
} from "../../../extension/hooks/tree-model";
import { HookLeaf } from "./HookLeaf";

interface Props {
  group: HookGroup;
  statuses: Record<string, HookTreeStatus>;
  workspaceRoot: string | null;
  onPreview(site: HookCallSite): void;
  onOpenSource(site: HookCallSite): void;
  onCopyIdentity(site: HookCallSite): void;
}

export function HookSection({
  group,
  statuses,
  workspaceRoot,
  onPreview,
  onOpenSource,
  onCopyIdentity,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const count = group.sites.length;
  const categoryLabel = group.category === "render" ? "render" : "data";

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1 px-3 py-1 text-left hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
      >
        <span className="inline-block w-3 text-[10px] text-[var(--vscode-descriptionForeground)]">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
        <span className="font-medium">{group.hook}</span>
        <span className="ml-1 text-[11px] text-[var(--vscode-descriptionForeground)]">
          ({count})
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
          {categoryLabel}
        </span>
      </button>
      {expanded && (
        <div>
          {group.sites.map((site) => (
            <HookLeaf
              key={`${site.filePath}:${site.loc.line}:${site.name ?? ""}`}
              site={site}
              category={group.category}
              status={statuses[statusKey(site)] ?? "unknown"}
              workspaceRoot={workspaceRoot}
              onPreview={onPreview}
              onOpenSource={onOpenSource}
              onCopyIdentity={onCopyIdentity}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function statusKey(site: HookCallSite): string {
  return `${site.filePath}::${site.hook}::${site.name ?? `line:${site.loc.line}`}`;
}
