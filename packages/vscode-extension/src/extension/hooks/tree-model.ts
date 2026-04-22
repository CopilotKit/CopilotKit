import type { HookCallSite } from "./hook-scanner";
import { HOOK_REGISTRY, type HookDef } from "./hook-registry";

/**
 * Pure (vscode-free) data model for the Hook Explorer. Keeping this
 * separate from view-provider code lets unit tests exercise the shape
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

/**
 * Registered hook group for the webview: a hook type with at least one call
 * site plus its leaves (sorted by identity label).
 */
export interface HookGroup {
  hook: string;
  category: "render" | "data";
  sites: HookCallSite[];
}

export interface GroupedSites {
  registered: HookGroup[];
  available: HookDef[];
}

/**
 * Groups sites for the webview Hook List. `registered` contains hook types
 * with ≥1 call site (sorted: render first, then data, alphabetical within).
 * `available` contains hook types from HOOK_REGISTRY that have zero sites —
 * shown in the "available hooks" section for discoverability.
 */
export function groupSitesByHook(
  sites: HookCallSite[],
  registry: ReadonlyArray<HookDef> = HOOK_REGISTRY,
): GroupedSites {
  const byHook = new Map<string, HookCallSite[]>();
  for (const s of sites) {
    const arr = byHook.get(s.hook) ?? [];
    arr.push(s);
    byHook.set(s.hook, arr);
  }

  const registered: HookGroup[] = [];
  const available: HookDef[] = [];
  for (const def of registry) {
    const entries = byHook.get(def.name);
    if (entries && entries.length > 0) {
      const sortedSites = [...entries].sort((a, b) => {
        const la = a.name ?? `line:${a.loc.line}`;
        const lb = b.name ?? `line:${b.loc.line}`;
        return la.localeCompare(lb);
      });
      registered.push({
        hook: def.name,
        category: def.category,
        sites: sortedSites,
      });
    } else {
      available.push(def);
    }
  }

  // Render hooks first, then data, preserving registry order within each.
  registered.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category === "render" ? -1 : 1;
    }
    return 0;
  });

  return { registered, available };
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
