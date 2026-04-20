import * as vscode from "vscode";
import * as fs from "node:fs";
import type { HookCallSite } from "./hook-scanner";
import { getHookDef } from "./hook-registry";
import { bundleHookSite } from "./hook-bundler";
import { HookControlsStore } from "./persistence";
import { getNonce } from "../utils";

interface WebviewControlsChangedMsg {
  type: "controlsChanged";
  selection: {
    filePath: string;
    hook: string;
    name: string | null;
    line: number;
  };
  values: Record<string, unknown>;
}

interface WebviewOpenSourceMsg {
  type: "openSource";
  filePath: string;
  line: number;
}

interface WebviewMountErrorMsg {
  type: "mountError";
  error: string;
}

interface WebviewReadyMsg {
  type: "ready";
}

type WebviewMsg =
  | WebviewControlsChangedMsg
  | WebviewOpenSourceMsg
  | WebviewMountErrorMsg
  | WebviewReadyMsg;

function isWebviewMsg(msg: unknown): msg is WebviewMsg {
  return (
    !!msg &&
    typeof msg === "object" &&
    "type" in (msg as Record<string, unknown>) &&
    typeof (msg as { type: unknown }).type === "string"
  );
}

export class HookPreviewPanel {
  public static readonly viewType = "copilotkit.hookPreview";
  private panel: vscode.WebviewPanel | null = null;
  private currentSite: HookCallSite | null = null;
  // Increments on every pushBundle invocation. A stale in-flight bundle
  // (e.g. a "load" whose bundleHookSite await takes longer than a subsequent
  // "reload") checks this token on resume and bails out — prevents out-of-
  // order messages reaching the webview and prevents postMessage on a
  // disposed panel.
  private pushToken = 0;
  // Webview is async-loading its JS. Messages posted before the webview
  // listener is attached get dropped — which is what left multiple hooks
  // stuck on "Waiting for scan…". Track readiness and buffer sends until
  // the webview pings back with `{type:"ready"}`.
  private webviewReady = false;
  private pendingMessages: unknown[] = [];

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
        this.webviewReady = false;
        this.pendingMessages = [];
      });
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
      const nonce = getNonce();
      this.panel.webview.html = this.html(nonce);
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

  private post(message: unknown): void {
    const panel = this.panel;
    if (!panel) return;
    if (this.webviewReady) {
      panel.webview.postMessage(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  private titleFor(site: HookCallSite): string {
    const id = site.name ?? `line:${site.loc.line}`;
    return `Hook · ${site.hook} · ${id}`;
  }

  private async pushBundle(type: "load" | "reload"): Promise<void> {
    const token = ++this.pushToken;
    const site = this.currentSite;
    if (!site || !this.panel) return;
    const def = getHookDef(site.hook);
    if (!def || def.category !== "render" || !def.renderProps) {
      this.post({
        type: "error",
        message: "Hook has no render-props kind",
      });
      return;
    }

    // Defensive: a stale in-memory site list (e.g. the user renamed or
    // deleted a fixture while the panel was open) can point at a path that
    // no longer exists. Rolldown throws UNRESOLVED_ENTRY for this, which
    // surfaces as a raw "Build failed" VS Code toast — catch it up front
    // and show a clean message instead.
    if (!fs.existsSync(site.filePath)) {
      this.post({
        type: "error",
        message:
          `Source file no longer exists: ${site.filePath}. ` +
          `It may have been renamed or deleted — refresh the hook list.`,
      });
      return;
    }
    const bundle = await bundleHookSite(site.filePath);
    // Drop this result if another pushBundle raced past us, or the panel
    // closed mid-await.
    if (token !== this.pushToken || !this.panel) return;

    if (!bundle.success || !bundle.code) {
      this.post({
        type: "error",
        message: bundle.error ?? "Bundle failed",
      });
      this.outputChannel.appendLine(
        `[bundle] ${site.filePath}: ${bundle.error}`,
      );
      return;
    }

    // MVP: schemaHint is always "none" — the webview reads the real config
    // from the captured registry and auto-forms V1 parameters / V2 Zod in-
    // webview via its own converters. Static extraction here via
    // `extractSchemaHint` (in schema-extraction.ts) is the future hookup.
    const schemaHint = { kind: "none" as const, payload: null };

    const persisted =
      this.controls.load(site.filePath, site.hook, site.name, site.loc.line) ??
      null;

    this.post({
      type,
      payload: {
        bundleCode: bundle.code,
        bundleCss: bundle.css ?? null,
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

  private async onMessage(raw: unknown): Promise<void> {
    if (!isWebviewMsg(raw)) return;
    if (raw.type === "ready") {
      this.webviewReady = true;
      const queued = this.pendingMessages.splice(0);
      for (const m of queued) this.panel?.webview.postMessage(m);
      return;
    }
    if (raw.type === "controlsChanged") {
      await this.controls.save(
        raw.selection.filePath,
        raw.selection.hook,
        raw.selection.name,
        raw.values ?? {},
        raw.selection.line,
      );
      return;
    }
    if (raw.type === "openSource") {
      const uri = vscode.Uri.file(raw.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preserveFocus: false,
      });
      const line = Math.max(0, (raw.line ?? 1) - 1);
      editor.revealRange(new vscode.Range(line, 0, line, 0));
      editor.selection = new vscode.Selection(line, 0, line, 0);
      return;
    }
    if (raw.type === "mountError") {
      this.outputChannel.appendLine(
        `[mount] ${this.currentSite?.filePath}: ${raw.error}`,
      );
    }
  }

  private html(nonce: string): string {
    if (!this.panel) return "";
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "hook-preview.js"),
    );
    // CSP notes:
    //  - `script-src 'nonce-${nonce}'` keeps scripts strictly nonced.
    //  - `style-src 'unsafe-inline'` is required for React's runtime style
    //    injection + CopilotKit's transitive CSS-in-JS helpers. We can't
    //    nonce styles the same way without rewriting every inline style.
    //  - `connect-src https:` allows the bundled host component's effects
    //    to talk to real user APIs; the fetch interceptor in the webview
    //    still filters the dummy CopilotKit runtime URL separately.
    return /* html */ `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src https: https://cdn.jsdelivr.net;"/>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style>
  body { margin: 0; padding: 0;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family); }
</style>
</head><body><div id="root"></div>
<script nonce="${nonce}">window.__copilotkit_nonce = ${JSON.stringify(nonce)};</script>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body></html>`;
  }
}
