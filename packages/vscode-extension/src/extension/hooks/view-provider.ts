import * as vscode from "vscode";
import * as path from "node:path";
import type { HookCallSite } from "./hook-scanner";
import { HOOK_REGISTRY } from "./hook-registry";

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

export class HookTreeDataProvider implements vscode.TreeDataProvider<HookNode> {
  private readonly _changeEmitter = new vscode.EventEmitter<
    HookNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._changeEmitter.event;

  private nodes: HookNode[] = [];
  private statusByKey = new Map<string, HookTreeStatus>();

  constructor(private readonly workspaceRoot: string | undefined) {}

  getAllNodes(): HookNode[] {
    return this.nodes;
  }

  private statusKey(site: HookCallSite): string {
    return `${site.filePath}::${site.hook}::${site.name ?? `line:${site.loc.line}`}`;
  }

  setSites(sites: HookCallSite[]): void {
    this.nodes = buildTreeData(sites);
    this.applyStatuses();
    this._changeEmitter.fire();
  }

  setStatus(site: HookCallSite, status: HookTreeStatus): void {
    this.statusByKey.set(this.statusKey(site), status);
    this.applyStatuses();
    this._changeEmitter.fire();
  }

  private applyStatuses(): void {
    for (const group of this.nodes) {
      for (const hookType of group.children) {
        for (const leaf of hookType.children) {
          if (leaf.site) {
            leaf.status =
              this.statusByKey.get(this.statusKey(leaf.site)) ?? "unknown";
          }
        }
      }
    }
  }

  getTreeItem(node: HookNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.kind === "leaf"
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Expanded,
    );
    if (node.kind === "leaf" && node.site) {
      item.contextValue = node.category === "render" ? "renderHook" : "dataHook";
      item.description = `${path.basename(node.site.filePath)}:${node.site.loc.line}`;
      item.tooltip = `${node.hook} • ${node.label} • ${node.site.filePath}:${node.site.loc.line}`;
      item.command = {
        command:
          node.category === "render"
            ? "copilotkit.hooks.preview"
            : "copilotkit.hooks.openSource",
        title: "",
        arguments: [node],
      };
      if (node.status === "captured") {
        item.iconPath = new vscode.ThemeIcon(
          "pass",
          new vscode.ThemeColor("testing.iconPassed"),
        );
      } else if (node.status === "not-captured") {
        item.iconPath = new vscode.ThemeIcon(
          "warning",
          new vscode.ThemeColor("editorWarning.foreground"),
        );
      } else if (node.status === "mount-error") {
        item.iconPath = new vscode.ThemeIcon(
          "error",
          new vscode.ThemeColor("editorError.foreground"),
        );
      }
    } else if (node.kind === "hook-type") {
      item.contextValue = "hookType";
    } else {
      item.contextValue = "group";
    }
    return item;
  }

  getChildren(node?: HookNode): HookNode[] {
    return node ? node.children : this.nodes;
  }
}
