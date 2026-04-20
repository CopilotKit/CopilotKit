import * as vscode from "vscode";
import * as path from "node:path";
import { scanWorkspace, scanFile, type HookCallSite } from "./hook-scanner";
import { HookPreviewPanel } from "./panel";
import { HookControlsStore } from "./persistence";
import { getHookDef } from "./hook-registry";
import { HookListViewProvider } from "./hook-list-view-provider";
import { HookLensProvider } from "./hook-lens-provider";

/**
 * True when `filePath` is the workspace root or lives beneath it. Prevents
 * `onDidSaveTextDocument` firing for a file the user opened via File > Open
 * (from some other directory on disk) from leaking an entry into the sidebar.
 */
function isInsideWorkspace(
  filePath: string,
  workspaceRoot: string | undefined,
): boolean {
  if (!workspaceRoot) return false;
  const rel = path.relative(workspaceRoot, filePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Wires the Hook Explorer feature into the extension's activation context:
 * output channel, persistence store, sidebar webview, preview panel, initial
 * workspace scan, save watcher, and all five `copilotkit.hooks.*` commands.
 *
 * Keeping this in its own file lets `activate.ts` stay a thin composition
 * root; it also makes the whole feature removable as a single diff.
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

  const panel = new HookPreviewPanel(
    context.extensionUri,
    store,
    outputChannel,
  );
  context.subscriptions.push({ dispose: () => panel.dispose() });

  // Flat site list owned here (previously owned by the tree provider). The
  // webview derives groups/statuses from the messages we push.
  let allSites: HookCallSite[] = [];

  const previewSite = async (site: HookCallSite) => {
    const def = getHookDef(site.hook);
    if (!def || def.category !== "render") return;
    await panel.show(site);
  };

  const openSourceSite = async (site: HookCallSite) => {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(site.filePath),
    );
    const editor = await vscode.window.showTextDocument(doc);
    const line = Math.max(0, site.loc.line - 1);
    editor.revealRange(new vscode.Range(line, 0, line, 0));
    editor.selection = new vscode.Selection(line, 0, line, 0);
  };

  const copyIdentity = async (site: HookCallSite) => {
    const id = `${site.hook}::${site.name ?? `line:${site.loc.line}`}`;
    await vscode.env.clipboard.writeText(id);
  };

  const doScan = () => {
    if (!workspaceRoot) {
      allSites = [];
      viewProvider.setSites(allSites);
      return;
    }
    try {
      allSites = scanWorkspace(workspaceRoot);
    } catch (err) {
      outputChannel.appendLine(
        `[scan] ${err instanceof Error ? err.message : String(err)}`,
      );
      allSites = [];
    }
    viewProvider.setSites(allSites);
  };

  const viewProvider = new HookListViewProvider(
    context.extensionUri,
    workspaceRoot ?? null,
    {
      onPreview: previewSite,
      onOpenSource: openSourceSite,
      onRefresh: () => doScan(),
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      HookListViewProvider.viewType,
      viewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  doScan();

  // Inline "▶️ Preview …" CodeLens above every render-hook call-site in
  // TypeScript and TypeScript-React files. Same click target as the
  // sidebar ▷ button — just available right where the hook is called.
  const lensProvider = new HookLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "typescript", scheme: "file" },
        { language: "typescriptreact", scheme: "file" },
      ],
      lensProvider,
    ),
  );

  // Per-file debounce map — batches rapid-fire saves (e.g. format-on-save
  // followed by a manual save) into a single rescan.
  const saveDebounce = new Map<string, NodeJS.Timeout>();
  const SAVE_DEBOUNCE_MS = 250;

  const updateSitesForFile = (filePath: string) => {
    const next = allSites.filter((s) => s.filePath !== filePath);
    try {
      next.push(...scanFile(filePath));
    } catch {
      // scanFile swallows parse / read failures; noop here.
    }
    allSites = next;
    viewProvider.setSites(allSites);
    lensProvider.refresh();
  };

  /**
   * Fallback picker used when one of the five hook commands is invoked from
   * the command palette (no site argument) — mirrors the tree-era
   * `focusPanel` UX but works for any action.
   */
  const pickSite = async (
    category: "render" | "data" | "any",
    placeHolder: string,
  ): Promise<HookCallSite | undefined> => {
    const items = allSites
      .filter((s) => category === "any" || s.category === category)
      .map((s) => ({
        label: s.name ?? `line:${s.loc.line}`,
        description: `${s.hook} \u00B7 ${path.basename(s.filePath)}:${s.loc.line}`,
        site: s,
      }));
    if (items.length === 0) {
      vscode.window.showInformationMessage("No matching hooks found.");
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder });
    return pick?.site;
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const filePath = doc.uri.fsPath;
      if (!/\.(ts|tsx)$/.test(filePath)) return;
      // Drop saves to files outside the active workspace so a stray tab from
      // File > Open doesn't drop its hook sites into the view.
      if (!isInsideWorkspace(filePath, workspaceRoot)) return;
      const existing = saveDebounce.get(filePath);
      if (existing) clearTimeout(existing);
      saveDebounce.set(
        filePath,
        setTimeout(() => {
          saveDebounce.delete(filePath);
          updateSitesForFile(filePath);
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
      async (site?: HookCallSite) => {
        const target = site ?? (await pickSite("any", "Pick a hook to open"));
        if (!target) return;
        await openSourceSite(target);
      },
    ),
    vscode.commands.registerCommand(
      "copilotkit.hooks.preview",
      async (site?: HookCallSite) => {
        const target =
          site ?? (await pickSite("render", "Pick a render hook to preview"));
        if (!target) return;
        await previewSite(target);
      },
    ),
    vscode.commands.registerCommand(
      "copilotkit.hooks.copyIdentity",
      async (site?: HookCallSite) => {
        const target =
          site ?? (await pickSite("any", "Pick a hook to copy identity"));
        if (!target) return;
        await copyIdentity(target);
      },
    ),
    vscode.commands.registerCommand("copilotkit.hooks.focusPanel", async () => {
      const target = await pickSite("render", "Pick a render hook to preview");
      if (target) await previewSite(target);
    }),
  );
}
