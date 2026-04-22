import * as vscode from "vscode";
import { DebugStream } from "./debug-stream";
import {
  InspectorToWebviewMessage,
  InspectorFromWebviewMessage,
} from "./inspector-types";
import { getNonce } from "./utils";

export class InspectorPanel {
  private panel: vscode.WebviewPanel | null = null;
  private ready = false;
  private messageQueue: InspectorToWebviewMessage[] = [];
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly debugStream: DebugStream,
  ) {}

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

    // Subscribe lazily — only while the panel is live. Avoids invoking the
    // event-envelope callback for every AG-UI event when no panel is open
    // (e.g. the shared DebugStream is connected for the sidebar inspector).
    this.unsubscribers.push(
      this.debugStream.onEvent((envelope) => {
        this.postMessage({ type: "debug-event", envelope });
      }),
      this.debugStream.onStatus((status) => {
        this.postMessage({ type: "connection-status", status });
      }),
      this.debugStream.onError((error) => {
        this.postMessage({ type: "connection-error", error });
      }),
    );

    this.panel.onDidDispose(() => {
      for (const unsub of this.unsubscribers) unsub();
      this.unsubscribers = [];
      this.panel = null;
      this.ready = false;
      this.messageQueue = [];
    });
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
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
