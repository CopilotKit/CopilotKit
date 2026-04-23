import * as fs from "node:fs";
import * as vscode from "vscode";
import type { PlaygroundScanResult } from "./types";
import type {
  PlaygroundExtensionToWebviewMessage,
  PlaygroundWebviewToExtensionMessage,
} from "./bridge-types";
import { getNonce } from "../utils";
import {
  writePlaygroundSources,
  type PlaygroundSources,
} from "./codegen/entry-codegen";
import { bundlePlayground, type PlaygroundBundleResult } from "./bundler";

export interface PlaygroundCallbacks {
  onRefresh(): void | Promise<void>;
  onOpenSource(filePath: string, line?: number): void | Promise<void>;
}

export interface PlaygroundDeps {
  writeSources: (scan: PlaygroundScanResult) => PlaygroundSources | null;
  bundle: (entryPath: string) => Promise<PlaygroundBundleResult>;
}

const DEFAULT_DEPS: PlaygroundDeps = {
  writeSources: writePlaygroundSources,
  bundle: bundlePlayground,
};

export class PlaygroundViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.chat";

  private view: vscode.WebviewView | null = null;
  private ready = false;
  private latestResult: PlaygroundScanResult | null = null;
  private latestBundle: PlaygroundExtensionToWebviewMessage | null = null;
  private bundleSeq = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: PlaygroundCallbacks,
    private readonly deps: PlaygroundDeps = DEFAULT_DEPS,
  ) {}

  setScanResult(result: PlaygroundScanResult): void {
    this.latestResult = result;
    this.latestBundle = null;
    if (this.ready) this.postResult();
    void this.runBundle(result);
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
            if (this.latestBundle) this.post(this.latestBundle);
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

  private async runBundle(result: PlaygroundScanResult): Promise<void> {
    const seq = ++this.bundleSeq;
    let sources: PlaygroundSources | null = null;

    try {
      sources = this.deps.writeSources(result);
      if (!sources) return;

      const bundle = await this.deps.bundle(sources.entryPath);

      // A newer scan has superseded us — discard this result silently.
      if (seq !== this.bundleSeq) return;

      if (!bundle.success || !bundle.code) {
        this.emitBundle({
          type: "bundle-error",
          message: bundle.error ?? "unknown bundle error",
        });
        return;
      }

      this.emitBundle({
        type: "bundle-ready",
        payload: { code: bundle.code, css: bundle.css },
      });
    } catch (err) {
      // Only emit if we're still the latest in-flight bundle.
      if (seq !== this.bundleSeq) return;
      this.emitBundle({
        type: "bundle-error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (sources) {
        try {
          fs.rmSync(sources.outDir, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }

  /** Caches the bundle envelope for replay-on-ready and posts it now. */
  private emitBundle(msg: PlaygroundExtensionToWebviewMessage): void {
    this.latestBundle = msg;
    this.post(msg);
  }

  private post(msg: PlaygroundExtensionToWebviewMessage): void {
    if (!this.view) return;
    this.view.webview.postMessage(msg);
  }

  private postResult(): void {
    if (!this.latestResult) return;
    this.post({ type: "scan-result", result: this.latestResult });
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "dist",
        "webview",
        "playground.js",
      ),
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
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
