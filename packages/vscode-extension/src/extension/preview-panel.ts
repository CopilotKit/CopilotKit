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
import type { ComponentRegistry } from "./component-registry";
import { getNonce } from "./utils";

export class PreviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentComponent: DiscoveredComponent | undefined;
  private disposables: vscode.Disposable[] = [];
  private webviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];

  constructor(
    private extensionUri: vscode.Uri,
    private diagnosticCollection: vscode.DiagnosticCollection,
    private registry?: ComponentRegistry,
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
    fixtureName?: string,
  ): Promise<void> {
    await Promise.all([
      this.bundleCatalogAndSend(component),
      this.sendFixtures(component, fixtureName),
    ]);
  }

  private async bundleCatalogAndSend(
    component: DiscoveredComponent,
  ): Promise<void> {
    const result = await bundleCatalog(component.filePath);

    if (result.success && result.code) {
      this.postMessage({
        type: "catalog-update",
        code: result.code,
        css: result.css,
      });
    } else {
      this.postMessage({
        type: "error",
        message: `Bundle error:\n${result.error}`,
      });
    }
  }

  private async sendFixtures(
    component: DiscoveredComponent,
    activeFixture?: string,
  ): Promise<void> {
    let fixtures: Record<string, A2UIFixture> = {};
    const fixturePath =
      component.fixturePath ?? findFixtureFile(component.filePath);

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
        // Note: TS/TSX fixtures are validated (above) but not yet runtime-
        // evaluated. The prior code posted a `type: "error"` message on
        // the successful-bundle path which rendered as a red error banner
        // — misleading, because a valid fixture is not an error. The
        // limitation is real but there's nothing the user can do in
        // response, so we stay silent here until we add a proper "info"
        // message type to the bridge.
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

    this.postMessage({ type: "fixture-update", fixtures, activeFixture });
  }

  // Cap pendingMessages so a never-ready webview (CSP violation, crashed
  // script, etc.) can't grow the buffer unbounded while the user keeps
  // saving fixtures. Matches the 1000-entry cap used by InspectorPanel.
  private static readonly MAX_PENDING_MESSAGES = 1000;
  // Latched flag so the cap-reached warning is logged exactly once per
  // "wedged webview" episode — reset on `ready` so a recovered session
  // can re-arm the warning if it wedges again.
  private pendingCapLogged = false;

  private postMessage(message: ExtensionToWebviewMessage): void {
    if (this.webviewReady && this.panel) {
      this.panel.webview.postMessage(message);
    } else if (
      this.pendingMessages.length < PreviewPanel.MAX_PENDING_MESSAGES
    ) {
      this.pendingMessages.push(message);
    } else if (!this.pendingCapLogged) {
      // Leave a breadcrumb: the webview isn't signalling `ready` and
      // we've given up buffering. The user's devtools usually has a
      // CSP violation or a bundle exception waiting to be read.
      this.pendingCapLogged = true;
      console.warn(
        `[CopilotKit preview-panel] pendingMessages cap (${PreviewPanel.MAX_PENDING_MESSAGES}) reached — ` +
          `webview never posted "ready". Check the webview devtools for CSP or bundle errors.`,
      );
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
        // Re-arm the cap warning: if the webview wedges again later in
        // the same session, we want a fresh breadcrumb.
        this.pendingCapLogged = false;
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
      case "catalog-schema":
        // Update the component registry with the real schema from the loaded catalog.
        // This replaces the regex-extracted schema with the authoritative Zod-derived one.
        if (this.registry && this.currentComponent?.fixturePath) {
          this.registry.updateFromCatalogSchema(
            this.currentComponent.fixturePath,
            message.schema,
          );
        }
        break;
    }
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.js"),
    );
    const nonce = getNonce();

    // CSP notes:
    //  - `blob:` in script-src is required by the A2UI catalog loading
    //    flow in `webview/App.tsx`, which `URL.createObjectURL`s the
    //    bundled IIFE and loads it via `<script src=blob:…>`. The blob
    //    content originates from the trusted extension host over
    //    postMessage (not from any external source), so the general
    //    concern that "blob: enables arbitrary-string JS" doesn't apply
    //    to the threat model here: the extension host itself is what
    //    would have to be compromised to feed malicious content, and if
    //    it is, CSP on the webview doesn't meaningfully contain damage.
    //  - The hook-preview panel (`hooks/panel.ts`) doesn't need `blob:`
    //    because it executes its IIFE via an inline `<script>` that's
    //    nonce-gated instead.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}' blob: https://cdn.jsdelivr.net; style-src 'unsafe-inline' ${webview.cspSource} https://cdn.jsdelivr.net; font-src ${webview.cspSource} https://cdn.jsdelivr.net; connect-src ${webview.cspSource} https://cdn.jsdelivr.net;">
  <title>CopilotKit Preview</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
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
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
