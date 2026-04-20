import * as vscode from "vscode";
import type { HookCallSite } from "./hook-scanner";
import { statusKeyForSite, type HookTreeStatus } from "./tree-model";
import type {
  HookListToWebviewMessage,
  HookListFromWebviewMessage,
} from "./hook-list-bridge-types";
import { getNonce } from "../utils";

/**
 * Callbacks the extension host wires up so the provider can remain UI-only.
 * Keeps the provider free of workspace / scanning concerns.
 */
export interface HookListCallbacks {
  onPreview(site: HookCallSite): void | Promise<void>;
  onOpenSource(site: HookCallSite): void | Promise<void>;
  onRefresh(): void | Promise<void>;
}

/**
 * Provides the Hook Explorer as a sidebar WebviewView. Mirrors the pattern
 * in InspectorViewProvider: the provider stores the latest sites/statuses,
 * replays them once the webview signals `ready`, and forwards incoming
 * messages to the injected callbacks.
 */
export class HookListViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.hooks";

  private view: vscode.WebviewView | null = null;
  private ready = false;

  private sites: HookCallSite[] = [];
  private statuses = new Map<string, HookTreeStatus>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceRoot: string | null,
    private readonly callbacks: HookListCallbacks,
  ) {}

  setSites(sites: HookCallSite[]): void {
    this.sites = sites;
    this.postSites();
  }

  setStatus(site: HookCallSite, status: HookTreeStatus): void {
    this.statuses.set(statusKeyForSite(site), status);
    this.postMessage({ type: "status", site, status });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    this.ready = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
      ],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg: HookListFromWebviewMessage) => {
        this.handleWebviewMessage(msg);
      },
    );

    webviewView.onDidDispose(() => {
      this.view = null;
      this.ready = false;
    });
  }

  private handleWebviewMessage(msg: HookListFromWebviewMessage): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        this.postMessage({
          type: "init",
          workspaceRoot: this.workspaceRoot,
        });
        this.postSites();
        break;
      case "preview":
        void this.callbacks.onPreview(msg.site);
        break;
      case "openSource":
        void this.callbacks.onOpenSource(msg.site);
        break;
      case "refresh":
        void this.callbacks.onRefresh();
        break;
    }
  }

  private postSites(): void {
    const statuses: Record<string, HookTreeStatus> = {};
    for (const [k, v] of this.statuses) statuses[k] = v;
    this.postMessage({ type: "sites", sites: this.sites, statuses });
  }

  private postMessage(msg: HookListToWebviewMessage): void {
    if (!this.view || !this.ready) return;
    this.view.webview.postMessage(msg);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "hook-list.js"),
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net;" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" nonce="${nonce}"></script>
  <title>CopilotKit Hooks</title>
</head>
<body class="bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] m-0 p-0 overflow-hidden h-screen">
  <div id="root" class="h-full"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
