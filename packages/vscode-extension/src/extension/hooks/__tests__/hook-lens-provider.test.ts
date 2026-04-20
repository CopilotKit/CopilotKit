import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookLensProvider } from "../hook-lens-provider";

// vscode is declared as a peer in the extension package and isn't available
// in the vitest runtime. Shim the one module surface HookLensProvider uses.
vi.mock("vscode", () => {
  class Range {
    constructor(
      public startLine: number,
      public startChar: number,
      public endLine: number,
      public endChar: number,
    ) {}
  }
  class CodeLens {
    constructor(public range: Range, public command: unknown) {}
  }
  class EventEmitter<T> {
    private listeners: Array<(v: T) => void> = [];
    event = (cb: (v: T) => void) => {
      this.listeners.push(cb);
      return { dispose: () => {} };
    };
    fire(v: T) {
      for (const cb of this.listeners) cb(v);
    }
  }
  return { Range, CodeLens, EventEmitter };
});

// HookLensProvider calls scanContent internally. We mock it here so the
// test asserts the provider's translation-layer behavior (not the parser).
vi.mock("../hook-scanner", () => ({
  scanContent: vi.fn(),
}));

import { scanContent } from "../hook-scanner";

function makeDoc(fsPath: string, text = ""): any {
  return {
    uri: { fsPath },
    getText: () => text,
  };
}

const noopToken = { isCancellationRequested: false } as any;

beforeEach(() => {
  vi.mocked(scanContent).mockReset();
});

describe("HookLensProvider", () => {
  it("returns [] for non-ts/tsx files without calling the scanner", () => {
    const provider = new HookLensProvider({ appendLine: vi.fn() } as any);
    const lenses = provider.provideCodeLenses(
      makeDoc("/tmp/foo.md"),
      noopToken,
    );
    expect(lenses).toEqual([]);
    expect(scanContent).not.toHaveBeenCalled();
  });

  it("returns [] when the cancellation token is tripped", () => {
    const provider = new HookLensProvider({ appendLine: vi.fn() } as any);
    const lenses = provider.provideCodeLenses(makeDoc("/tmp/foo.tsx"), {
      isCancellationRequested: true,
    } as any);
    expect(lenses).toEqual([]);
    expect(scanContent).not.toHaveBeenCalled();
  });

  it("emits a lens for every render hook with the exact title/command", () => {
    vi.mocked(scanContent).mockReturnValue([
      {
        filePath: "/tmp/Foo.tsx",
        hook: "useCopilotAction",
        name: "addTodo",
        loc: { line: 7, column: 0, endLine: 7, endColumn: 20 },
        category: "render",
      },
    ]);
    const provider = new HookLensProvider({ appendLine: vi.fn() } as any);
    const lenses = provider.provideCodeLenses(
      makeDoc("/tmp/Foo.tsx", "// contents"),
      noopToken,
    );
    expect(lenses).toHaveLength(1);
    const cmd = (lenses[0] as any).command;
    expect(cmd.title).toBe("\u25B6\uFE0F Preview Component");
    expect(cmd.command).toBe("copilotkit.hooks.preview");
    expect(cmd.arguments?.[0]).toEqual({
      filePath: "/tmp/Foo.tsx",
      hook: "useCopilotAction",
      name: "addTodo",
      loc: { line: 7, column: 0, endLine: 7, endColumn: 20 },
      category: "render",
    });
  });

  it("skips data-category hooks", () => {
    vi.mocked(scanContent).mockReturnValue([
      {
        filePath: "/tmp/Foo.tsx",
        hook: "useCopilotReadable",
        name: null,
        loc: { line: 3, column: 0, endLine: 3, endColumn: 10 },
        category: "data",
      },
    ]);
    const provider = new HookLensProvider({ appendLine: vi.fn() } as any);
    const lenses = provider.provideCodeLenses(
      makeDoc("/tmp/Foo.tsx"),
      noopToken,
    );
    expect(lenses).toEqual([]);
  });

  it("uses document.getText() (not the disk) so dirty buffers track live edits", () => {
    vi.mocked(scanContent).mockReturnValue([]);
    const provider = new HookLensProvider({ appendLine: vi.fn() } as any);
    const liveContent = "live edits not yet saved";
    provider.provideCodeLenses(
      makeDoc("/tmp/Foo.tsx", liveContent),
      noopToken,
    );
    expect(scanContent).toHaveBeenCalledWith("/tmp/Foo.tsx", liveContent);
  });

  it("logs to the output channel when scanContent throws, and returns []", () => {
    vi.mocked(scanContent).mockImplementation(() => {
      throw new Error("oxc crashed");
    });
    const appendLine = vi.fn();
    const provider = new HookLensProvider({ appendLine } as any);
    const lenses = provider.provideCodeLenses(
      makeDoc("/tmp/Foo.tsx"),
      noopToken,
    );
    expect(lenses).toEqual([]);
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining("oxc crashed"),
    );
  });
});
