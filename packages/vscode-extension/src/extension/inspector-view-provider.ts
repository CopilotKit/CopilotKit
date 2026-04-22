import * as vscode from "vscode";
import { DebugStream } from "./debug-stream";
import {
  InspectorToWebviewMessage,
  InspectorFromWebviewMessage,
  DebugEventEnvelope,
} from "./inspector-types";
import { getNonce } from "./utils";

const MAX_BUFFERED_EVENTS = 10_000;

/**
 * Provides the AG-UI Inspector as a sidebar WebviewView.
 * Shares a DebugStream so events flow to both the sidebar and the editor panel.
 *
 * Buffers events persistently so that events received while the sidebar is
 * hidden (e.g. user switched to Explorer) are replayed when the view reopens.
 */
export class InspectorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.inspector";

  private view: vscode.WebviewView | null = null;
  private ready = false;
  private pendingMessages: InspectorToWebviewMessage[] = [];

  /** Persistent event buffer — survives view dispose/recreate cycles. */
  private eventBuffer: DebugEventEnvelope[] = [];
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly debugStream: DebugStream,
  ) {
    this.unsubscribers.push(
      this.debugStream.onEvent((envelope) => {
        // Always buffer, regardless of view state
        this.eventBuffer.push(envelope);
        if (this.eventBuffer.length > MAX_BUFFERED_EVENTS) {
          this.eventBuffer = this.eventBuffer.slice(
            this.eventBuffer.length - MAX_BUFFERED_EVENTS,
          );
        }
        this.postMessage({ type: "debug-event", envelope });
      }),
      this.debugStream.onStatus((status) => {
        this.postMessage({ type: "connection-status", status });
      }),
      this.debugStream.onError((error) => {
        this.postMessage({ type: "connection-error", error });
      }),
    );
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    this.ready = false;
    this.pendingMessages = [];

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
      this.pendingMessages = [];
    });
  }

  private handleWebviewMessage(msg: InspectorFromWebviewMessage): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        // Replay buffered events so the webview catches up
        for (const envelope of this.eventBuffer) {
          this.view?.webview.postMessage({
            type: "debug-event",
            envelope,
          });
        }
        // Flush any pending non-event messages (status, errors)
        for (const queued of this.pendingMessages) {
          this.view?.webview.postMessage(queued);
        }
        this.pendingMessages = [];
        break;
      case "connect":
        this.debugStream.connect(msg.runtimeUrl);
        break;
      case "disconnect":
        this.debugStream.disconnect();
        break;
      case "clear":
        this.eventBuffer = [];
        this.postMessage({ type: "clear" });
        break;
    }
  }

  private postMessage(msg: InspectorToWebviewMessage): void {
    // If the view isn't ready yet, queue non-event messages (status/error).
    // Event messages are handled separately via eventBuffer.
    if (!this.view || !this.ready) {
      if (msg.type !== "debug-event" && this.pendingMessages.length < 100) {
        this.pendingMessages.push(msg);
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
