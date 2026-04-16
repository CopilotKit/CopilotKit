import * as vscode from "vscode";
import { DebugStream } from "./debug-stream";
import {
  InspectorToWebviewMessage,
  InspectorFromWebviewMessage,
} from "./inspector-types";
import { getNonce } from "./utils";

/**
 * Provides the AG-UI Inspector as a sidebar WebviewView.
 * Shares a DebugStream so events flow to both the sidebar and the editor panel.
 */
export class InspectorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.inspector";

  private view: vscode.WebviewView | null = null;
  private ready = false;
  private messageQueue: InspectorToWebviewMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly debugStream: DebugStream,
  ) {
    this.debugStream.onEvent((envelope) => {
      this.postMessage({ type: "debug-event", envelope });
    });

    this.debugStream.onStatus((status) => {
      this.postMessage({ type: "connection-status", status });
    });

    this.debugStream.onError((error) => {
      this.postMessage({ type: "connection-error", error });
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
      ],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg: InspectorFromWebviewMessage) => {
        this.handleWebviewMessage(msg);
      },
    );

    webviewView.onDidDispose(() => {
      this.view = null;
      this.ready = false;
      this.messageQueue = [];
    });
  }

  private handleWebviewMessage(msg: InspectorFromWebviewMessage): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        for (const queued of this.messageQueue) {
          this.view?.webview.postMessage(queued);
        }
        this.messageQueue = [];
        break;
      case "connect":
        this.debugStream.connect(msg.runtimeUrl);
        break;
      case "disconnect":
        this.debugStream.disconnect();
        break;
      case "clear":
        this.postMessage({ type: "clear" });
        break;
    }
  }

  private postMessage(msg: InspectorToWebviewMessage): void {
    if (!this.view) return;

    if (!this.ready) {
      if (this.messageQueue.length < 1000) {
        this.messageQueue.push(msg);
      }
      return;
    }

    this.view.webview.postMessage(msg);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "inspector.js"),
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
  <title>AG-UI Inspector</title>
</head>
<body class="bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] m-0 p-0 overflow-hidden h-screen">
  <div id="root" class="h-full"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
