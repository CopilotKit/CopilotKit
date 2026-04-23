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
import { detectMode, type RuntimeMode } from "./mode-detector";
import {
  resolveLlmConfig,
  parseEnvFile,
  type LlmConfigResult,
} from "./llm-config";
import { startAimock, type AimockHandle } from "./aimock-lifecycle";
import { spawnRuntime, type RuntimeHandle } from "./runtime-spawn";
import {
  FixtureStore,
  type FixtureListEntry,
  type FixtureMetadata,
  type SavedFixture,
} from "./fixture-store";

export interface PlaygroundCallbacks {
  onRefresh(): void | Promise<void>;
  onOpenSource(filePath: string, line?: number): void | Promise<void>;
}

export interface PlaygroundDeps {
  writeSources: (
    scan: PlaygroundScanResult,
    opts?: { runtimeUrlOverride?: string },
  ) => PlaygroundSources | null;
  bundle: (entryPath: string) => Promise<PlaygroundBundleResult>;
  detectMode: (runtimeUrl: unknown) => RuntimeMode;
  resolveLlmConfig: () => Promise<LlmConfigResult>;
  startAimock: (opts: {
    provider: "openai" | "anthropic";
    upstreamUrl: string;
    replayFixturePath?: string;
  }) => Promise<AimockHandle>;
  spawnRuntime: (opts: {
    entryScript: string;
    config: {
      port: number;
      llmBaseUrl: string;
      provider: "openai" | "anthropic";
      model: string;
      apiKey: string;
    };
  }) => Promise<RuntimeHandle>;
  /** Absolute path to dist/runtime/subprocess-entry.cjs. */
  runtimeEntryScript: string;
  fixtureStore: {
    list(): FixtureListEntry[];
    read(filePath: string): SavedFixture;
    save(metadata: FixtureMetadata, body: { recording: unknown[] }): string;
    delete(filePath: string): void;
  };
}

export class PlaygroundViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.chat";

  private view: vscode.WebviewView | null = null;
  private ready = false;
  private latestResult: PlaygroundScanResult | null = null;
  private latestBundle: PlaygroundExtensionToWebviewMessage | null = null;
  private bundleSeq = 0;
  private currentSession: {
    aimock: AimockHandle;
    runtime: RuntimeHandle;
  } | null = null;
  private replayFixturePath: string | null = null;
  private replayFixtureName: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: PlaygroundCallbacks,
    private readonly deps: PlaygroundDeps,
  ) {}

  setScanResult(result: PlaygroundScanResult): void {
    this.latestResult = result;
    this.latestBundle = null;
    if (this.ready) this.postResult();
    void this.stopSession().then(() => this.runBundle(result));
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
      async (msg: PlaygroundWebviewToExtensionMessage) => {
        try {
          switch (msg.type) {
            case "ready":
              this.ready = true;
              if (this.latestResult) this.postResult();
              if (this.latestBundle) this.post(this.latestBundle);
              this.post({
                type: "fixtures-list",
                fixtures: this.deps.fixtureStore.list(),
              });
              return;
            case "refresh":
              void this.callbacks.onRefresh();
              return;
            case "open-source":
              void this.callbacks.onOpenSource(msg.filePath, msg.line);
              return;
            case "save-fixture": {
              if (!this.currentSession) return;
              const journal = this.currentSession.aimock.getJournal();
              const config = await this.deps.resolveLlmConfig();
              if (config.source === "missing") return;
              const filePath = this.deps.fixtureStore.save(
                {
                  name: msg.name,
                  createdAt: new Date().toISOString(),
                  provider: config.provider,
                  model: config.model,
                },
                { recording: journal },
              );
              this.post({ type: "fixture-saved", filePath });
              this.post({
                type: "fixtures-list",
                fixtures: this.deps.fixtureStore.list(),
              });
              return;
            }
            case "load-fixture": {
              this.replayFixturePath = msg.filePath;
              try {
                this.replayFixtureName =
                  this.deps.fixtureStore.read(msg.filePath).metadata.name ??
                  null;
              } catch {
                this.replayFixtureName = null;
              }
              if (this.latestResult) {
                this.setScanResult(this.latestResult);
              }
              return;
            }
            case "new-chat": {
              this.replayFixturePath = null;
              this.replayFixtureName = null;
              if (this.latestResult) {
                this.setScanResult(this.latestResult);
              }
              return;
            }
            case "delete-fixture": {
              this.deps.fixtureStore.delete(msg.filePath);
              this.post({
                type: "fixtures-list",
                fixtures: this.deps.fixtureStore.list(),
              });
              return;
            }
          }
        } catch (err) {
          this.post({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

    webviewView.onDidDispose(() => {
      this.view = null;
      this.ready = false;
      void this.stopSession();
    });
  }

  async stopSession(): Promise<void> {
    if (!this.currentSession) return;
    const { aimock, runtime } = this.currentSession;
    this.currentSession = null;
    await Promise.allSettled([aimock.stop(), runtime.stop()]);
  }

  private async runBundle(result: PlaygroundScanResult): Promise<void> {
    const seq = ++this.bundleSeq;
    let sources: PlaygroundSources | null = null;
    let session: { aimock: AimockHandle; runtime: RuntimeHandle } | null = null;

    try {
      const provider = result.providers[0];
      if (!provider) return;

      // 1. Mode check.
      const mode = this.deps.detectMode(provider.props.runtimeUrl);
      if (mode.kind === "proxy-unsupported") {
        this.emitBundle({
          type: "mode-unsupported",
          kind: "proxy",
          detail: mode.url,
        });
        return;
      }
      if (mode.kind === "proxy-unsupported-dynamic") {
        this.emitBundle({
          type: "mode-unsupported",
          kind: "dynamic-runtime-url",
          detail: mode.expressionSource,
        });
        return;
      }

      // 2. LLM config.
      const config = await this.deps.resolveLlmConfig();
      if (config.source === "missing") {
        this.emitBundle({ type: "llm-config-missing" });
        return;
      }

      // 3-4. aimock + runtime.
      const aimock = await this.deps.startAimock({
        provider: config.provider,
        upstreamUrl:
          config.provider === "openai"
            ? "https://api.openai.com"
            : "https://api.anthropic.com",
        replayFixturePath: this.replayFixturePath ?? undefined,
      });
      const runtime = await this.deps.spawnRuntime({
        entryScript: this.deps.runtimeEntryScript,
        config: {
          port: 0,
          llmBaseUrl: aimock.url,
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
        },
      });
      session = { aimock, runtime };

      // 5. Codegen with runtime URL override.
      sources = this.deps.writeSources(result, {
        runtimeUrlOverride: `${runtime.url}/api/copilotkit`,
      });
      if (!sources) {
        await Promise.allSettled([aimock.stop(), runtime.stop()]);
        session = null;
        return;
      }

      // 6. Bundle.
      const bundle = await this.deps.bundle(sources.entryPath);
      if (seq !== this.bundleSeq) {
        await Promise.allSettled([aimock.stop(), runtime.stop()]);
        session = null;
        return;
      }

      if (!bundle.success || !bundle.code) {
        await Promise.allSettled([aimock.stop(), runtime.stop()]);
        session = null;
        this.emitBundle({
          type: "bundle-error",
          message: bundle.error ?? "unknown bundle error",
        });
        return;
      }

      // 7. Transfer session ownership to currentSession and emit ready.
      this.currentSession = session;
      session = null;
      this.emitBundle({
        type: "bundle-ready",
        payload: { code: bundle.code, css: bundle.css },
      });
      this.post({
        type: "session-info",
        runtimeUrl: runtime.url,
        replayMode: aimock.isReplayMode,
        fixtureName: this.replayFixtureName,
      });
      this.post({
        type: "fixtures-list",
        fixtures: this.deps.fixtureStore.list(),
      });
    } catch (err) {
      if (seq !== this.bundleSeq) return;
      this.emitBundle({
        type: "runtime-error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (sources) {
        try {
          fs.rmSync(sources.outDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
      // Clean up any orphaned session (created but not transferred).
      if (session) {
        await Promise.allSettled([
          session.aimock.stop(),
          session.runtime.stop(),
        ]);
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
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "dist",
        "webview",
        "playground.css",
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
  <link rel="stylesheet" href="${stylesUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__copilotkit_nonce = ${JSON.stringify(nonce)};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function createPlaygroundDeps(
  context: vscode.ExtensionContext,
  workspaceRoot: string | null,
): PlaygroundDeps {
  return {
    writeSources: writePlaygroundSources,
    bundle: bundlePlayground,
    detectMode,
    resolveLlmConfig: () =>
      resolveLlmConfig(workspaceRoot ?? "", {
        readSecret: (k) => Promise.resolve(context.secrets.get(k)),
        readSetting: (k) => vscode.workspace.getConfiguration().get(k),
        readEnvFile: parseEnvFile,
      }),
    startAimock,
    spawnRuntime,
    runtimeEntryScript: vscode.Uri.joinPath(
      context.extensionUri,
      "dist",
      "runtime",
      "subprocess-entry.cjs",
    ).fsPath,
    fixtureStore: new FixtureStore(workspaceRoot ?? ""),
  };
}
