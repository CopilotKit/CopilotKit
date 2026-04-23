import * as vscode from "vscode";
import type { PlaygroundScanResult } from "./types";
import type {
  PlaygroundExtensionToWebviewMessage,
  PlaygroundWebviewToExtensionMessage,
} from "./bridge-types";
import { getNonce } from "../utils";

export interface PlaygroundCallbacks {
  onRefresh(): void | Promise<void>;
  onOpenSource(filePath: string, line?: number): void | Promise<void>;
}

export class PlaygroundViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.chat";

  private view: vscode.WebviewView | null = null;
  private ready = false;
  private latestResult: PlaygroundScanResult | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: PlaygroundCallbacks,
  ) {}

  setScanResult(result: PlaygroundScanResult): void {
    this.latestResult = result;
    if (this.ready) this.postResult();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
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
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg: PlaygroundWebviewToExtensionMessage) => {
        switch (msg.type) {
          case "ready":
            this.ready = true;
            if (this.latestResult) this.postResult();
            return;
          case "refresh":
            void this.callbacks.onRefresh();
            return;
          case "open-source":
            void this.callbacks.onOpenSource(msg.filePath, msg.line);
            return;
        }
      },
    );

    webviewView.onDidDispose(() => {
      this.view = null;
      this.ready = false;
    });
  }

  private postResult(): void {
    if (!this.latestResult || !this.view) return;
    const msg: PlaygroundExtensionToWebviewMessage = {
      type: "scan-result",
      result: this.latestResult,
    };
    this.view.webview.postMessage(msg);
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "playground.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "playground.css"),
    );
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join("; ");
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
