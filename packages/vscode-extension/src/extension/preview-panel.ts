import * as vscode from "vscode";
import * as fs from "node:fs";
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  A2UIFixture,
  DiscoveredComponent,
} from "./types";
import { bundleCatalog } from "./bundler";
import { parseFixtureJson, validateFixture } from "./fixture-validator";
import { findFixtureFile } from "./sidebar/component-scanner";

export class PreviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentComponent: DiscoveredComponent | undefined;
  private disposables: vscode.Disposable[] = [];
  private webviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];

  constructor(
    private extensionUri: vscode.Uri,
    private diagnosticCollection: vscode.DiagnosticCollection,
  ) {}

  async show(
    component: DiscoveredComponent,
    fixtureName?: string,
  ): Promise<void> {
    this.currentComponent = component;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "copilotkit.preview",
        `Preview: ${component.name}`,
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
        (msg: WebviewToExtensionMessage) => this.handleWebviewMessage(msg),
        undefined,
        this.disposables,
      );

      this.panel.onDidDispose(
        () => {
          this.panel = undefined;
          this.webviewReady = false;
          this.disposables.forEach((d) => d.dispose());
          this.disposables = [];
        },
        undefined,
        this.disposables,
      );
    }

    this.panel.title = `Preview: ${component.name}`;
    await this.bundleAndSend(component, fixtureName);
  }

  async handleFileChange(filePath: string): Promise<void> {
    if (!this.currentComponent) return;

    if (filePath.includes(".fixture.")) {
      await this.sendFixtures(this.currentComponent);
    } else if (
      filePath === this.currentComponent.filePath ||
      filePath.endsWith(".ts") ||
      filePath.endsWith(".tsx")
    ) {
      await this.bundleCatalogAndSend(this.currentComponent);
    }
  }

  getCurrentComponent(): DiscoveredComponent | undefined {
    return this.currentComponent;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async bundleAndSend(
    component: DiscoveredComponent,
    _fixtureName?: string,
  ): Promise<void> {
    await Promise.all([
      this.bundleCatalogAndSend(component),
      this.sendFixtures(component),
    ]);
  }

  private async bundleCatalogAndSend(
    component: DiscoveredComponent,
  ): Promise<void> {
    const result = await bundleCatalog(component.filePath);

    if (result.success && result.code) {
      this.postMessage({ type: "catalog-update", code: result.code });
    } else {
      this.postMessage({
        type: "error",
        message: `Bundle error:\n${result.error}`,
      });
    }
  }

  private async sendFixtures(component: DiscoveredComponent): Promise<void> {
    let fixtures: Record<string, A2UIFixture> = {};
    const fixturePath = component.fixturePath ?? findFixtureFile(component.filePath);

    if (fixturePath && fs.existsSync(fixturePath)) {
      const content = fs.readFileSync(fixturePath, "utf-8");

      if (fixturePath.endsWith(".json")) {
        const result = parseFixtureJson(content);
        if (result.valid && result.fixtures) {
          fixtures = result.fixtures;
          this.diagnosticCollection.delete(vscode.Uri.file(fixturePath));
        } else {
          const diagnostics = result.errors.map(
            (err) =>
              new vscode.Diagnostic(
                new vscode.Range(
                  (err.line ?? 1) - 1,
                  (err.column ?? 1) - 1,
                  (err.line ?? 1) - 1,
                  100,
                ),
                err.message,
                vscode.DiagnosticSeverity.Warning,
              ),
          );
          this.diagnosticCollection.set(
            vscode.Uri.file(fixturePath),
            diagnostics,
          );
        }
      } else {
        const validation = validateFixture(fixturePath, content);
        if (!validation.valid) {
          this.postMessage({
            type: "error",
            message: `Fixture validation error:\n${validation.errors.map((e) => e.message).join("\n")}`,
          });
        }
        const bundleResult = await bundleCatalog(fixturePath);
        if (bundleResult.success && bundleResult.code) {
          this.postMessage({
            type: "error",
            message:
              "TypeScript fixture files are validated but not yet evaluated. Use .fixture.json for full support.",
          });
        }
      }
    }

    if (Object.keys(fixtures).length === 0) {
      fixtures = {
        default: {
          surfaceId: "preview",
          messages: [],
        },
      };
    }

    this.postMessage({ type: "fixture-update", fixtures });
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    if (this.webviewReady && this.panel) {
      this.panel.webview.postMessage(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  private handleWebviewMessage(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case "ready":
        this.webviewReady = true;
        for (const msg of this.pendingMessages) {
          this.panel?.webview.postMessage(msg);
        }
        this.pendingMessages = [];
        break;
      case "request-rebuild":
        if (this.currentComponent) {
          this.bundleAndSend(this.currentComponent);
        }
        break;
      case "action":
        console.log("[CopilotKit] Action:", message.payload);
        break;
      case "select-fixture":
        break;
    }
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.iife.js"),
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}' blob:; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource};">
  <title>CopilotKit Preview</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
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
