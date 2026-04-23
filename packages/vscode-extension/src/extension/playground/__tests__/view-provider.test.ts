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
