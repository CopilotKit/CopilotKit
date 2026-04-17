import type { HookCallSite } from "./hook-scanner";
import { HOOK_REGISTRY } from "./hook-registry";

/**
 * Pure (vscode-free) data model for the Hook Explorer tree. Keeping this
 * separate from `view-provider.ts` lets unit tests exercise the shape
 * without mocking the `vscode` module.
 */

export type HookTreeStatus =
  | "captured"
  | "not-captured"
  | "mount-error"
  | "unknown";

export interface HookNode {
  label: string;
  kind: "group" | "hook-type" | "leaf";
  category?: "render" | "data";
  hook?: string;
  site?: HookCallSite;
  status?: HookTreeStatus;
  children: HookNode[];
}

export function buildTreeData(sites: HookCallSite[]): HookNode[] {
  const renderGroup: HookNode = {
    label: "Render hooks",
    kind: "group",
    children: [],
  };
  const dataGroup: HookNode = {
    label: "Data hooks",
    kind: "group",
    children: [],
  };

  const byHook = new Map<string, HookCallSite[]>();
  for (const s of sites) {
    const arr = byHook.get(s.hook) ?? [];
    arr.push(s);
    byHook.set(s.hook, arr);
  }

  for (const def of HOOK_REGISTRY) {
    const entries = byHook.get(def.name) ?? [];
    const target = def.category === "render" ? renderGroup : dataGroup;
    const leaves: HookNode[] = entries
      .map((s) => ({
        label: s.name ?? `line:${s.loc.line}`,
        kind: "leaf" as const,
        category: def.category,
        hook: def.name,
        site: s,
        status: "unknown" as HookTreeStatus,
        children: [],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    target.children.push({
      label: `${def.name}  (${entries.length})`,
      kind: "hook-type",
      category: def.category,
      hook: def.name,
      children: leaves,
    });
  }

  return [renderGroup, dataGroup];
}

export function statusKeyForSite(site: HookCallSite): string {
  return `${site.filePath}::${site.hook}::${site.name ?? `line:${site.loc.line}`}`;
}

/**
 * Locate the leaf in an existing tree that matches the given site. Returns
 * null if the site isn't in the tree (e.g. scan result changed in between).
 */
export function findLeaf(
  tree: HookNode[],
  site: HookCallSite,
): HookNode | null {
  const targetKey = statusKeyForSite(site);
  for (const group of tree) {
    for (const hookType of group.children) {
      for (const leaf of hookType.children) {
        if (leaf.site && statusKeyForSite(leaf.site) === targetKey) {
          return leaf;
        }
      }
    }
  }
  return null;
}
