import { describe, expect, it, vi } from "vitest";

// vscode is not available in the vitest runtime — shim the surface used by
// PlaygroundViewProvider (Uri.joinPath for renderHtml, nothing else).
vi.mock("vscode", () => ({
  Uri: {
    joinPath: (_base: unknown, ...parts: string[]) => ({
      toString: () => parts.join("/"),
    }),
  },
}));

import { PlaygroundViewProvider } from "../view-provider";
import type { PlaygroundScanResult } from "../types";

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
    const provider = new PlaygroundViewProvider(
      { fsPath: "/fake", scheme: "file" } as never,
      { onRefresh, onOpenSource },
      { bundle: bundleFn, writeSources: codegenFn },
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
    await new Promise((r) => setTimeout(r, 0));

    expect(codegenFn).toHaveBeenCalledWith(result);
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
      { bundle: bundleFn, writeSources: codegenFn },
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
    await new Promise((r) => setTimeout(r, 0));

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
      { bundle: bundleFn, writeSources: codegenFn },
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
    await new Promise((r) => setTimeout(r, 0));

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
