import { describe, expect, it, vi } from "vitest";

// vscode is not available in the vitest runtime — shim the surface used by
// PlaygroundViewProvider (Uri.joinPath for renderHtml, nothing else).
vi.mock("vscode", () => ({
  Uri: {
    joinPath: (_base: unknown, ...parts: string[]) => ({
      toString: () => parts.join("/"),
      fsPath: parts.join("/"),
    }),
  },
}));

import { PlaygroundViewProvider } from "../view-provider";
import type { PlaygroundDeps } from "../view-provider";
import type { PlaygroundScanResult } from "../types";

function makeDeps(overrides: Partial<PlaygroundDeps> = {}): PlaygroundDeps {
  return {
    writeSources: vi.fn(),
    bundle: vi.fn(),
    detectMode: vi.fn().mockReturnValue({ kind: "embed" }),
    pickModel: vi.fn().mockResolvedValue({
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      family: "gpt-4o-mini",
      vendor: "openai",
    }),
    listModels: vi.fn().mockResolvedValue([]),
    startRuntimeHost: vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:22222",
      stop: vi.fn().mockResolvedValue(undefined),
    }),
    fixtureStore: {
      list: vi.fn().mockReturnValue([]),
      read: vi.fn(),
      save: vi.fn().mockReturnValue("/fake/.copilotkit/fixtures/x.json"),
      delete: vi.fn(),
    },
    readPreferredModelId: vi.fn().mockReturnValue(""),
    writePreferredModelId: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeWebview() {
  const listeners: Array<(msg: unknown) => void> = [];
  return {
    webview: {
      options: {},
      html: "",
      onDidReceiveMessage: (fn: (msg: unknown) => void) => {
        listeners.push(fn);
        return { dispose: () => {} };
      },
      postMessage: vi.fn(),
      asWebviewUri: (uri: unknown) => uri,
      cspSource: "vscode-webview://fake",
    },
    onDidDispose: (_fn: () => void) => ({ dispose: () => {} }),
    send: (msg: unknown) => listeners.forEach((l) => l(msg)),
  };
}

const emptyResult: PlaygroundScanResult = {
  providers: [],
  componentsWithHooks: [],
  hookSites: [],
  warnings: [],
};

describe("PlaygroundViewProvider", () => {
  it("replays the last scan result once the webview signals ready", () => {
    const onRefresh = vi.fn();
    const onOpenSource = vi.fn();
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh, onOpenSource },
      makeDeps(),
    );

    provider.setScanResult(emptyResult);

    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);

    expect(view.webview.postMessage).not.toHaveBeenCalled();

    view.send({ type: "ready" });
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "scan-result",
      result: emptyResult,
    });
  });

  it("forwards refresh and open-source messages to callbacks", () => {
    const onRefresh = vi.fn();
    const onOpenSource = vi.fn();
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh, onOpenSource },
      makeDeps(),
    );

    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);

    view.send({ type: "refresh" });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    view.send({ type: "open-source", filePath: "/a.tsx", line: 7 });
    expect(onOpenSource).toHaveBeenCalledWith("/a.tsx", 7);
  });
});

describe("PlaygroundViewProvider — bundling", () => {
  it("posts bundle-ready after setScanResult when a provider is present", async () => {
    const bundleFn = vi.fn().mockResolvedValue({
      code: "var __copilotkit_playground = {};",
      success: true,
    });
    const codegenFn = vi.fn().mockReturnValue({
      outDir: "/tmp/ignored",
      entryPath: "/tmp/ignored/entry.tsx",
    });

    const onRefresh = vi.fn();
    const onOpenSource = vi.fn();
    const deps = makeDeps({
      bundle: bundleFn,
      writeSources: codegenFn,
    });
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh, onOpenSource },
      deps,
    );

    const result: PlaygroundScanResult = {
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: {},
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    };

    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });

    provider.setScanResult(result);
    await new Promise((r) => setTimeout(r, 30));

    expect(codegenFn).toHaveBeenCalledWith(result, {
      runtimeUrlOverride: "http://127.0.0.1:22222/api/copilotkit",
    });
    expect(bundleFn).toHaveBeenCalledWith("/tmp/ignored/entry.tsx");
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "bundle-ready",
      payload: { code: "var __copilotkit_playground = {};", css: undefined },
    });
  });

  it("posts bundle-error when bundling fails", async () => {
    const bundleFn = vi
      .fn()
      .mockResolvedValue({ success: false, error: "rolldown exploded" });
    const codegenFn = vi.fn().mockReturnValue({
      outDir: "/tmp/ignored",
      entryPath: "/tmp/ignored/entry.tsx",
    });

    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      makeDeps({ bundle: bundleFn, writeSources: codegenFn }),
    );

    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });

    provider.setScanResult({
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: {},
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "bundle-error",
      message: "rolldown exploded",
    });
  });

  it("replays the last bundle when the webview signals ready", async () => {
    const bundleFn = vi.fn().mockResolvedValue({
      code: "var __copilotkit_playground = {};",
      success: true,
    });
    const codegenFn = vi.fn().mockReturnValue({
      outDir: "/tmp/ignored",
      entryPath: "/tmp/ignored/entry.tsx",
    });

    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      makeDeps({ bundle: bundleFn, writeSources: codegenFn }),
    );

    // Scan arrives BEFORE the webview resolves.
    provider.setScanResult({
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: {},
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
    await new Promise((r) => setTimeout(r, 30));

    // Now the webview resolves and signals ready.
    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });

    // Both scan-result and bundle-ready must have been posted.
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scan-result" }),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bundle-ready" }),
    );
  });
});

describe("PlaygroundViewProvider — HTML bootstrap", () => {
  it("injects a nonce bootstrap script so bundle-loader can discover it", () => {
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      makeDeps(),
    );
    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    // The test webview mock receives the HTML via `webview.html = ...`
    const html = view.webview.html;
    // The HTML must include a bootstrap script that writes the nonce.
    expect(html).toMatch(/window\.__copilotkit_nonce\s*=/);
    // It must include the bundle script with a nonce attribute.
    expect(html).toMatch(/nonce="[^"]+"[^>]*src="/);
  });
});

describe("PlaygroundViewProvider — orchestration", () => {
  it("posts mode-unsupported for absolute runtimeUrl", async () => {
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      makeDeps({
        detectMode: vi.fn().mockReturnValue({
          kind: "proxy-unsupported",
          url: "https://api.example.com",
        }),
      }),
    );
    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });
    provider.setScanResult({
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: { runtimeUrl: "https://api.example.com" },
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "mode-unsupported", kind: "proxy" }),
    );
  });

  it("posts no-model-available when no model is returned", async () => {
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      makeDeps({
        pickModel: vi.fn().mockResolvedValue(null),
      }),
    );
    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });
    provider.setScanResult({
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: {},
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "no-model-available" }),
    );
  });

  it("starts runtime host and passes runtime URL to codegen", async () => {
    const writeSourcesFn = vi.fn().mockReturnValue({
      outDir: "/tmp/ignored",
      entryPath: "/tmp/ignored/entry.tsx",
    });
    const bundleFn = vi.fn().mockResolvedValue({
      code: "var __copilotkit_playground = {};",
      success: true,
    });
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      makeDeps({ writeSources: writeSourcesFn, bundle: bundleFn }),
    );
    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });
    provider.setScanResult({
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: {},
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
    // Allow multiple microtask turns for the chained awaits in runBundle.
    await new Promise((r) => setTimeout(r, 30));
    expect(writeSourcesFn).toHaveBeenCalledWith(expect.anything(), {
      runtimeUrlOverride: "http://127.0.0.1:22222/api/copilotkit",
    });
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bundle-ready" }),
    );
  });

  it("stops the previous session when setScanResult is called again", async () => {
    const stop1 = vi.fn().mockResolvedValue(undefined);
    const stop2 = vi.fn().mockResolvedValue(undefined);
    const runtime1 = { url: "http://127.0.0.1:33333", stop: stop1 };
    const runtime2 = { url: "http://127.0.0.1:44444", stop: stop2 };
    const deps = makeDeps({
      writeSources: vi.fn().mockReturnValue({
        outDir: "/tmp/ignored",
        entryPath: "/tmp/ignored/entry.tsx",
      }),
      bundle: vi.fn().mockResolvedValue({ success: true, code: "var x;" }),
      startRuntimeHost: vi
        .fn()
        .mockResolvedValueOnce(runtime1)
        .mockResolvedValueOnce(runtime2),
    });
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      deps,
    );
    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });

    const scan: PlaygroundScanResult = {
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: {},
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    };
    provider.setScanResult(scan);
    await new Promise((r) => setTimeout(r, 30));
    provider.setScanResult(scan);
    await new Promise((r) => setTimeout(r, 60));

    expect(stop1).toHaveBeenCalled();
  });

  it("saves a fixture when save-fixture is received", async () => {
    const saveFn = vi.fn().mockReturnValue("/fake/.copilotkit/fixtures/x.json");
    const listFn = vi.fn().mockReturnValue([
      {
        filePath: "/fake/.copilotkit/fixtures/x.json",
        metadata: {
          name: "x",
          createdAt: "2026-04-23T12:00:00Z",
          modelId: "gpt-4o-mini",
          modelVendor: "openai",
          version: 2 as const,
        },
      },
    ]);
    const fakeModel = {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      family: "gpt-4o-mini",
      vendor: "openai",
    };
    const deps = makeDeps({
      writeSources: vi.fn().mockReturnValue({
        outDir: "/tmp",
        entryPath: "/tmp/x.tsx",
      }),
      bundle: vi.fn().mockResolvedValue({ success: true, code: "var x;" }),
      pickModel: vi.fn().mockResolvedValue(fakeModel),
      startRuntimeHost: vi.fn().mockResolvedValue({
        url: "http://127.0.0.1:22222",
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      fixtureStore: {
        list: listFn,
        read: vi.fn(),
        save: saveFn,
        delete: vi.fn(),
      },
    });
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh: vi.fn(), onOpenSource: vi.fn() },
      deps,
    );
    const view = makeWebview();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.send({ type: "ready" });
    provider.setScanResult({
      providers: [
        {
          filePath: "/x/App.tsx",
          loc: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          importedName: "CopilotKitProvider",
          importSource: "@copilotkit/react-core/v2",
          props: {},
        },
      ],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
    await new Promise((r) => setTimeout(r, 60));
    view.send({ type: "save-fixture", name: "my-session" });
    await new Promise((r) => setTimeout(r, 30));
    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "my-session",
        modelId: "gpt-4o-mini",
        modelVendor: "openai",
        version: 2,
      }),
      { calls: [] },
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fixtures-list" }),
    );
  });
});
