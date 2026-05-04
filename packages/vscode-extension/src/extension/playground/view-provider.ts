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
import { startRuntimeHost, type RuntimeHostHandle } from "./runtime-host";
import { listModels, pickModel } from "./model-picker";
import {
  FixtureStore,
  type FixtureListEntry,
  type FixtureMetadata,
  type SavedFixture,
} from "./fixture-store";
import type { RecordedCall } from "./vscode-lm-factory";

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
  pickModel: (opts?: {
    preferredId?: string;
  }) => Promise<vscode.LanguageModelChat | null>;
  listModels: () => Promise<vscode.LanguageModelChat[]>;
  startRuntimeHost: (opts: {
    model: vscode.LanguageModelChat;
    mode: "live" | "record" | "replay";
    fixtureCalls?: RecordedCall[];
    onCallRecorded?: (call: RecordedCall) => void;
    log: (line: string) => void;
    enableVscodeLmTools?: boolean;
  }) => Promise<RuntimeHostHandle>;
  fixtureStore: {
    list(): FixtureListEntry[];
    read(filePath: string): SavedFixture;
    save(metadata: FixtureMetadata, body: { calls: RecordedCall[] }): string;
    delete(filePath: string): void;
  };
  /** Reads the `copilotkit.playground.model` setting. */
  readPreferredModelId: () => string;
  /** Persists the user's model selection (workspace-scoped). */
  writePreferredModelId: (id: string) => Promise<void>;
  /** Reads the `copilotkit.playground.enableVscodeLmTools` setting. */
  readEnableVscodeLmTools: () => boolean;
}

export class PlaygroundViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotkit.chat";

  private view: vscode.WebviewView | null = null;
  private ready = false;
  private latestResult: PlaygroundScanResult | null = null;
  private latestBundle: PlaygroundExtensionToWebviewMessage | null = null;
  private bundleSeq = 0;
  private currentSession: {
    runtime: RuntimeHostHandle;
    recordedCalls: RecordedCall[];
    model: vscode.LanguageModelChat;
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
              this.post({
                type: "models-list",
                models: (await this.deps.listModels()).map((m) => ({
                  id: m.id,
                  name: m.name,
                  family: m.family,
                  vendor: m.vendor,
                })),
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
              const filePath = this.deps.fixtureStore.save(
                {
                  name: msg.name,
                  createdAt: new Date().toISOString(),
                  modelId: this.currentSession.model.id,
                  modelVendor: this.currentSession.model.vendor,
                  version: 2,
                },
                { calls: this.currentSession.recordedCalls },
              );
              this.post({
                type: "fixtures-list",
                fixtures: this.deps.fixtureStore.list(),
              });
              this.callbacks.onOpenSource(filePath);
              return;
            }
            case "select-model": {
              await this.deps.writePreferredModelId(msg.id);
              if (this.latestResult) {
                await this.stopSession();
                void this.runBundle(this.latestResult);
              }
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
    const { runtime } = this.currentSession;
    this.currentSession = null;
    await Promise.allSettled([runtime.stop()]);
  }

  private log(line: string): void {
    // No-op in the class itself; the real log is captured in createPlaygroundDeps.
    void line;
  }

  private async runBundle(result: PlaygroundScanResult): Promise<void> {
    const seq = ++this.bundleSeq;
    let sources: PlaygroundSources | null = null;
    let session: {
      runtime: RuntimeHostHandle;
      recordedCalls: RecordedCall[];
      model: vscode.LanguageModelChat;
    } | null = null;

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

      // 3. Pick a model.
      const model = await this.deps.pickModel({
        preferredId: this.deps.readPreferredModelId(),
      });
      if (!model) {
        this.emitBundle({ type: "no-model-available" });
        return;
      }

      // 4. Start the runtime host (in-process).
      const recordedCalls: RecordedCall[] = [];
      const replayFixture = this.replayFixturePath
        ? this.deps.fixtureStore.read(this.replayFixturePath)
        : null;
      const runtime = await this.deps.startRuntimeHost({
        model,
        mode: replayFixture ? "replay" : "record",
        fixtureCalls: replayFixture?.calls,
        onCallRecorded: (call) => recordedCalls.push(call),
        log: (line) => this.log(line),
        enableVscodeLmTools: this.deps.readEnableVscodeLmTools(),
      });
      session = { runtime, recordedCalls, model };

      // 5. Codegen with runtime URL override.
      sources = this.deps.writeSources(result, {
        runtimeUrlOverride: `${runtime.url}/api/copilotkit`,
      });
      if (!sources) {
        await Promise.allSettled([runtime.stop()]);
        session = null;
        return;
      }

      // 6. Bundle.
      const bundle = await this.deps.bundle(sources.entryPath);
      if (seq !== this.bundleSeq) {
        await Promise.allSettled([runtime.stop()]);
        session = null;
        return;
      }

      if (!bundle.success || !bundle.code) {
        await Promise.allSettled([runtime.stop()]);
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
        replayMode: replayFixture !== null,
        fixtureName: this.replayFixtureName,
        vscodeLmTools: runtime.vscodeLmTools,
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
        await Promise.allSettled([session.runtime.stop()]);
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
    // CopilotKit v2 chat components ship a precompiled Tailwind bundle.
    // The user normally imports it from their app entry; in the playground
    // we mount their components in isolation, so we ship the stylesheet
    // alongside playground.css and load it via a <link> tag here.
    const v2StylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "dist",
        "webview",
        "copilotkit-v2.css",
      ),
    );
    const nonce = getNonce();
    // The bundled user app fetches the in-process runtime at
    // http://127.0.0.1:<random-port>/api/copilotkit. CSP defaults to
    // `default-src 'none'`, which would block that fetch. Allow only
    // localhost on any port (the runtime-host picks a fresh port per
    // session). No public origins are needed — vscode.lm runs in the
    // extension host, not the webview.
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `connect-src http://127.0.0.1:* http://localhost:*`,
    ].join("; ");
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${v2StylesUri}" />
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
  workspaceRoot: string | null,
  log: (line: string) => void = () => {},
): PlaygroundDeps {
  return {
    writeSources: writePlaygroundSources,
    bundle: bundlePlayground,
    detectMode,
    pickModel,
    listModels,
    startRuntimeHost: (opts) => startRuntimeHost({ ...opts, log }),
    fixtureStore: new FixtureStore(workspaceRoot ?? "", { onWarn: log }),
    readPreferredModelId: () =>
      vscode.workspace
        .getConfiguration()
        .get<string>("copilotkit.playground.model", ""),
    writePreferredModelId: async (id) => {
      await vscode.workspace
        .getConfiguration()
        .update(
          "copilotkit.playground.model",
          id,
          vscode.ConfigurationTarget.Workspace,
        );
    },
    readEnableVscodeLmTools: () =>
      vscode.workspace
        .getConfiguration()
        .get<boolean>("copilotkit.playground.enableVscodeLmTools", false),
  };
}
