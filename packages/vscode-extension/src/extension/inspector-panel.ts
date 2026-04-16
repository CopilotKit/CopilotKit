import * as vscode from "vscode";
import { DebugStream } from "./debug-stream";
import {
  InspectorToWebviewMessage,
  InspectorFromWebviewMessage,
} from "./inspector-types";

export class InspectorPanel {
  private panel: vscode.WebviewPanel | null = null;
  private debugStream: DebugStream;
  private ready = false;
  private messageQueue: InspectorToWebviewMessage[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.debugStream = new DebugStream();

    this.debugStream.onEvent((envelope) => {
      this.postMessage({ type: "debug-event", envelope });
    });

    this.debugStream.onStatus((status) => {
      this.postMessage({ type: "connection-status", status });
    });
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "copilotkit.inspector",
      "AG-UI Inspector",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        ],
      },
    );

    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg: InspectorFromWebviewMessage) => {
        this.handleWebviewMessage(msg);
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.ready = false;
      this.messageQueue = [];
      this.debugStream.disconnect();
    });
  }

  dispose(): void {
    this.debugStream.dispose();
    this.panel?.dispose();
  }

  private handleWebviewMessage(msg: InspectorFromWebviewMessage): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        for (const queued of this.messageQueue) {
          this.panel?.webview.postMessage(queued);
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
    if (!this.panel) return;

    if (!this.ready) {
      if (this.messageQueue.length < 1000) {
        this.messageQueue.push(msg);
      }
      return;
    }

    this.panel.webview.postMessage(msg);
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

function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
