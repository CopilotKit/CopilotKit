import * as vscode from "vscode";
import { scanWorkspace } from "./hook-scanner";
import { HookTreeDataProvider, type HookNode } from "./view-provider";
import { HookPreviewPanel } from "./panel";
import { HookControlsStore } from "./persistence";
import { getHookDef } from "./hook-registry";

/**
 * Wires the Hook Explorer feature into the extension's activation context:
 * output channel, persistence store, sidebar tree, preview panel, initial
 * workspace scan, save watcher, and all five `copilotkit.hooks.*` commands.
 *
 * Keeping this in its own file lets `activate.ts` stay a thin composition
 * root; it also makes the whole feature removable as a single diff.
 *
 * Follow-up: save watcher currently triggers a full `scanWorkspace`. For
 * large monorepos this is O(workspace) per save; a targeted `scanFile` +
 * merge would be better. Debounce would also help. Left for a follow-up
 * since it requires shared mutable state in the tree provider.
 */
export function activateHookExplorer(
  context: vscode.ExtensionContext,
  workspaceRoot: string | undefined,
): void {
  const outputChannel = vscode.window.createOutputChannel(
    "CopilotKit Hook Explorer",
  );
  context.subscriptions.push(outputChannel);

  const store = new HookControlsStore(
    context.workspaceState,
    workspaceRoot ?? "",
  );
  const tree = new HookTreeDataProvider(workspaceRoot);
  const view = vscode.window.createTreeView("copilotkit.hooks", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);

  const panel = new HookPreviewPanel(
    context.extensionUri,
    store,
    outputChannel,
  );
  context.subscriptions.push({ dispose: () => panel.dispose() });

  const doScan = () => {
    if (!workspaceRoot) {
      tree.setSites([]);
      return;
    }
    try {
      tree.setSites(scanWorkspace(workspaceRoot));
    } catch (err) {
      outputChannel.appendLine(
        `[scan] ${err instanceof Error ? err.message : String(err)}`,
      );
      tree.setSites([]);
    }
  };
  doScan();

  // Per-file debounce map — batches rapid-fire saves (e.g. format-on-save
  // followed by a manual save) into a single rescan. Replaces the prior
  // full-workspace rescan on every save.
  const saveDebounce = new Map<string, NodeJS.Timeout>();
  const SAVE_DEBOUNCE_MS = 250;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const filePath = doc.uri.fsPath;
      if (!/\.(ts|tsx)$/.test(filePath)) return;
      const existing = saveDebounce.get(filePath);
      if (existing) clearTimeout(existing);
      saveDebounce.set(
        filePath,
        setTimeout(() => {
          saveDebounce.delete(filePath);
          tree.updateSitesForFile(filePath);
          void panel.handleFileChange(filePath);
        }, SAVE_DEBOUNCE_MS),
      );
    }),
    {
      dispose: () => {
        for (const timer of saveDebounce.values()) clearTimeout(timer);
        saveDebounce.clear();
      },
    },
    vscode.commands.registerCommand("copilotkit.hooks.refresh", () => doScan()),
    vscode.commands.registerCommand(
      "copilotkit.hooks.openSource",
      async (node: HookNode) => {
        if (!node?.site) return;
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(node.site.filePath),
        );
        const editor = await vscode.window.showTextDocument(doc);
        const line = Math.max(0, node.site.loc.line - 1);
        editor.revealRange(new vscode.Range(line, 0, line, 0));
        editor.selection = new vscode.Selection(line, 0, line, 0);
      },
    ),
    vscode.commands.registerCommand(
      "copilotkit.hooks.preview",
      async (node: HookNode) => {
        if (!node?.site) return;
        const def = getHookDef(node.site.hook);
        if (!def || def.category !== "render") return;
        await panel.show(node.site);
      },
    ),
    vscode.commands.registerCommand(
      "copilotkit.hooks.copyIdentity",
      async (node: HookNode) => {
        if (!node?.site) return;
        const id = `${node.site.hook}::${node.site.name ?? `line:${node.site.loc.line}`}`;
        await vscode.env.clipboard.writeText(id);
      },
    ),
    vscode.commands.registerCommand("copilotkit.hooks.focusPanel", async () => {
      // Filter to render leaves by category rather than by group label so
      // copy changes in view-provider.ts don't silently break this.
      const items: (vscode.QuickPickItem & { node: HookNode })[] = [];
      for (const group of tree.getAllNodes()) {
        for (const hookType of group.children) {
          for (const leaf of hookType.children) {
            if (!leaf.site || leaf.category !== "render") continue;
            items.push({
              label: leaf.label,
              description: `${leaf.hook ?? ""} · ${leaf.site.filePath}:${leaf.site.loc.line}`,
              node: leaf,
            });
          }
        }
      }
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: "Pick a render hook to preview",
      });
      if (pick?.node.site) await panel.show(pick.node.site);
    }),
  );
}
