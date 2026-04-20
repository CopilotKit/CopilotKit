import * as vscode from "vscode";
import { scanFile, type HookCallSite } from "./hook-scanner";
import { getHookDef } from "./hook-registry";

/**
 * CodeLens provider that surfaces a "▶️ Preview" lens above every render
 * hook call-site (useCopilotAction, useRenderTool, useLangGraphInterrupt,
 * etc.). Clicking the lens runs `copilotkit.hooks.preview` with the
 * resolved site, which opens the hook-preview webview — the same flow the
 * sidebar uses.
 *
 * Only render-category hooks get a lens; data hooks have nothing to
 * preview. The provider scans the file on demand via the same oxc parser
 * as the sidebar, so lens positions are always in sync with the sidebar
 * list without a separate cache to invalidate.
 */
export class HookLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  /** Callers invoke this after a relevant file change so lenses refresh. */
  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (token.isCancellationRequested) return [];
    if (!/\.(ts|tsx)$/.test(document.uri.fsPath)) return [];

    let sites: HookCallSite[];
    try {
      sites = scanFile(document.uri.fsPath);
    } catch {
      return [];
    }
    const lenses: vscode.CodeLens[] = [];
    for (const site of sites) {
      const def = getHookDef(site.hook);
      if (!def || def.category !== "render" || !def.renderProps) continue;
      // VS Code ranges are 0-based; our scanner returns 1-based lines.
      const line = Math.max(0, site.loc.line - 1);
      const range = new vscode.Range(line, 0, line, 0);
      const identity = site.name ?? `line:${site.loc.line}`;
      lenses.push(
        new vscode.CodeLens(range, {
          title: `\u25B6\uFE0F Preview ${site.hook}${
            site.name ? ` (${site.name})` : ""
          }`,
          tooltip: `Preview ${site.hook} \u2014 ${identity}`,
          command: "copilotkit.hooks.preview",
          arguments: [site],
        }),
      );
    }
    return lenses;
  }
}
