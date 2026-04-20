import * as vscode from "vscode";
import type { DiscoveredComponent } from "../types";
import type {
  CatalogListToWebviewMessage,
  CatalogListFromWebviewMessage,
} from "./catalog-list-bridge-types";
import { getNonce } from "../utils";

export interface CatalogListCallbacks {
  onPreview(
    component: DiscoveredComponent,
    fixtureName?: string,
  ): void | Promise<void>;
  onOpenSource(
    component: DiscoveredComponent,
    fixtureName?: string,
  ): void | Promise<void>;
  onRefresh(): void | Promise<void>;
}

/**
 * Webview-backed replacement for the tree-based `ComponentPreviewProvider`.
 * Mirrors the shape of `HookListViewProvider`: buffer until the webview
 * posts `ready`, then flush init + list; forward user actions back through
 * the injected callbacks.
 */
export class CatalogListViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.componentPreview";

  private view: vscode.WebviewView | null = null;
  private ready = false;
  private components: DiscoveredComponent[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceRoot: string | null,
    private readonly callbacks: CatalogListCallbacks,
  ) {}

  setComponents(components: DiscoveredComponent[]): void {
    this.components = components;
    this.postComponents();
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
      (msg: CatalogListFromWebviewMessage) => this.handleWebviewMessage(msg),
    );

    webviewView.onDidDispose(() => {
      this.view = null;
      this.ready = false;
    });
  }

  private handleWebviewMessage(msg: CatalogListFromWebviewMessage): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        this.postMessage({ type: "init", workspaceRoot: this.workspaceRoot });
        this.postComponents();
        break;
      case "preview":
        // Normalize at the wire boundary — JSON round-trip can turn an
        // omitted field into explicit `null`, which matches neither
        // `string` nor `undefined` at the callback's declared type.
        void this.callbacks.onPreview(
          msg.component,
          msg.fixtureName ?? undefined,
        );
        break;
      case "openSource":
        void this.callbacks.onOpenSource(
          msg.component,
          msg.fixtureName ?? undefined,
        );
        break;
      case "refresh":
        void this.callbacks.onRefresh();
        break;
      default: {
        // Exhaustiveness guard — adding a new variant to
        // `CatalogListFromWebviewMessage` without handling it here will
        // fail type-check at this line. At runtime, a version-skew
        // scenario (older host receiving a newer webview's message)
        // would land here — log so the skew leaves a breadcrumb.
        const _exhaustive: never = msg;
        void _exhaustive;
        // eslint-disable-next-line no-console
        console.warn(
          "[catalog-list] unknown wire-protocol message type:",
          (msg as { type?: unknown }).type,
        );
      }
    }
  }

  private postComponents(): void {
    this.postMessage({ type: "components", components: this.components });
  }

  private postMessage(msg: CatalogListToWebviewMessage): void {
    if (!this.view || !this.ready) return;
    this.view.webview.postMessage(msg);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "dist",
        "webview",
        "catalog-list.js",
      ),
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
  <title>A2UI Catalog</title>
</head>
<body class="bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] m-0 p-0 overflow-hidden h-screen">
  <div id="root" class="h-full"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
