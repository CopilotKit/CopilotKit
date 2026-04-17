import * as vscode from "vscode";
import * as path from "node:path";
import type { HookCallSite } from "./hook-scanner";
import { scanFile } from "./hook-scanner";
import {
  buildTreeData,
  findLeaf,
  statusKeyForSite,
  type HookNode,
  type HookTreeStatus,
} from "./tree-model";

// Re-export the pure model types so existing consumers keep importing from
// view-provider (the documented public surface) without knowing about the
// internal split.
export type { HookNode, HookTreeStatus };
export { buildTreeData };

export class HookTreeDataProvider implements vscode.TreeDataProvider<HookNode> {
  private readonly _changeEmitter = new vscode.EventEmitter<
    HookNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._changeEmitter.event;

  private nodes: HookNode[] = [];
  private statusByKey = new Map<string, HookTreeStatus>();
  // Flat site list we can update per-file without re-running scanWorkspace.
  // Populated by setSites() and updateSitesForFile().
  private allSites: HookCallSite[] = [];

  constructor(private readonly workspaceRoot: string | undefined) {}

  getAllNodes(): HookNode[] {
    return this.nodes;
  }

  setSites(sites: HookCallSite[]): void {
    this.allSites = sites;
    this.nodes = buildTreeData(sites);
    this.applyStatuses();
    // Full refresh is the right signal when the underlying site list changes.
    this._changeEmitter.fire();
  }

  /**
   * Re-scan a single file and splice its sites into the tree. Cheaper than
   * a full workspace rescan on every save.
   */
  updateSitesForFile(filePath: string): void {
    const next = this.allSites.filter((s) => s.filePath !== filePath);
    try {
      next.push(...scanFile(filePath));
    } catch {
      // scanFile swallows parse / read failures; noop here.
    }
    this.allSites = next;
    this.nodes = buildTreeData(next);
    this.applyStatuses();
    this._changeEmitter.fire();
  }

  setStatus(site: HookCallSite, status: HookTreeStatus): void {
    this.statusByKey.set(statusKeyForSite(site), status);
    const leaf = findLeaf(this.nodes, site);
    if (!leaf) return;
    leaf.status = status;
    // Targeted refresh — VS Code re-reads only the affected leaf via
    // getTreeItem(), preserving the user's expand/collapse state elsewhere.
    this._changeEmitter.fire(leaf);
  }

  private applyStatuses(): void {
    for (const group of this.nodes) {
      for (const hookType of group.children) {
        for (const leaf of hookType.children) {
          if (leaf.site) {
            leaf.status =
              this.statusByKey.get(statusKeyForSite(leaf.site)) ?? "unknown";
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
