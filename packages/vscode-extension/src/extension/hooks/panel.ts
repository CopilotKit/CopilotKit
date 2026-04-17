import * as vscode from "vscode";
import type { HookCallSite } from "./hook-scanner";
import { getHookDef } from "./hook-registry";
import { bundleHookSite } from "./hook-bundler";
import { HookControlsStore } from "./persistence";
import { getNonce } from "../utils";

export class HookPreviewPanel {
  public static readonly viewType = "copilotkit.hookPreview";
  private panel: vscode.WebviewPanel | null = null;
  private currentSite: HookCallSite | null = null;
  private currentNonce: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controls: HookControlsStore,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async show(site: HookCallSite): Promise<void> {
    this.currentSite = site;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        HookPreviewPanel.viewType,
        this.titleFor(site),
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = null;
        this.currentSite = null;
        this.currentNonce = null;
      });
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
      this.currentNonce = getNonce();
      this.panel.webview.html = this.html(this.currentNonce);
    } else {
      this.panel.title = this.titleFor(site);
      this.panel.reveal(vscode.ViewColumn.Beside, false);
    }
    await this.pushBundle("load");
  }

  async handleFileChange(filePath: string): Promise<void> {
    if (!this.panel || !this.currentSite) return;
    if (this.currentSite.filePath !== filePath) return;
    await this.pushBundle("reload");
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  private titleFor(site: HookCallSite): string {
    const id = site.name ?? `line:${site.loc.line}`;
    return `Hook · ${site.hook} · ${id}`;
  }

  private async pushBundle(type: "load" | "reload"): Promise<void> {
    const site = this.currentSite;
    if (!site || !this.panel) return;
    const def = getHookDef(site.hook);
    if (!def || def.category !== "render" || !def.renderProps) {
      this.panel.webview.postMessage({
        type: "error",
        message: "Hook has no render-props kind",
      });
      return;
    }

    const bundle = await bundleHookSite(site.filePath);
    if (!bundle.success || !bundle.code) {
      this.panel.webview.postMessage({
        type: "error",
        message: bundle.error ?? "Bundle failed",
      });
      this.outputChannel.appendLine(`[bundle] ${site.filePath}: ${bundle.error}`);
      return;
    }

    // MVP: schemaHint is always "none" — the webview reads the real config
    // from the captured registry and auto-forms V1 parameters / V2 Zod
    // directly in-webview. Static extraction from source is follow-up work.
    const schemaHint = { kind: "none" as const, payload: null };

    const persisted =
      this.controls.load(site.filePath, site.hook, site.name, site.loc.line) ??
      null;

    this.panel.webview.postMessage({
      type,
      payload: {
        bundleCode: bundle.code,
        selection: {
          filePath: site.filePath,
          hook: site.hook,
          name: site.name,
          line: site.loc.line,
          renderProps: def.renderProps,
        },
        persistedControls: persisted,
        schemaHint,
      },
    });
  }

  private async onMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    if (m.type === "controlsChanged" && m.selection) {
      const sel = m.selection as {
        filePath: string;
        hook: string;
        name: string | null;
        line: number;
      };
      await this.controls.save(
        sel.filePath,
        sel.hook,
        sel.name,
        (m.values as Record<string, unknown>) ?? {},
        sel.line,
      );
    } else if (m.type === "openSource" && typeof m.filePath === "string") {
      const uri = vscode.Uri.file(m.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preserveFocus: false,
      });
      const line = Math.max(0, ((m.line as number) ?? 1) - 1);
      editor.revealRange(new vscode.Range(line, 0, line, 0));
      editor.selection = new vscode.Selection(line, 0, line, 0);
    } else if (m.type === "mountError") {
      this.outputChannel.appendLine(
        `[mount] ${this.currentSite?.filePath}: ${m.error}`,
      );
    }
  }

  private html(nonce: string): string {
    if (!this.panel) return "";
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "hook-preview.js"),
    );
    return /* html */ `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src https:;"/>
</head><body><div id="root"></div>
<script nonce="${nonce}">window.__copilotkit_nonce = ${JSON.stringify(nonce)};</script>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body></html>`;
  }
}
