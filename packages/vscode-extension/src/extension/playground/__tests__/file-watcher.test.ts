/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vscode is mocked at the workspace level (see other extension-host tests).
// We only need a minimal stub for FileSystemWatcher.
type Handler = (uri: { fsPath: string }) => void;
const handlers: {
  change: Handler[];
  create: Handler[];
  delete: Handler[];
} = { change: [], create: [], delete: [] };

vi.mock("vscode", () => ({
  workspace: {
    createFileSystemWatcher: () => ({
      onDidChange: (h: Handler) => handlers.change.push(h),
      onDidCreate: (h: Handler) => handlers.create.push(h),
      onDidDelete: (h: Handler) => handlers.delete.push(h),
      dispose: () => {},
    }),
  },
}));

import { PlaygroundFileWatcher } from "../file-watcher";

beforeEach(() => {
  handlers.change = [];
  handlers.create = [];
  handlers.delete = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function fireChange(fsPath: string): void {
  for (const h of handlers.change) h({ fsPath });
}
function fireCreate(fsPath: string): void {
  for (const h of handlers.create) h({ fsPath });
}
function fireDelete(fsPath: string): void {
  for (const h of handlers.delete) h({ fsPath });
}

describe("PlaygroundFileWatcher", () => {
  it("debounces a burst of changes into a single callback", () => {
    const onAnyChange = vi.fn();
    const watcher = new PlaygroundFileWatcher(onAnyChange, {
      debounceMs: 100,
    });

    fireChange("/work/src/Foo.tsx");
    fireChange("/work/src/Bar.tsx");
    fireChange("/work/src/Baz.tsx");

    expect(onAnyChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onAnyChange).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it("treats create + delete + change as equivalent triggers", () => {
    const onAnyChange = vi.fn();
    const watcher = new PlaygroundFileWatcher(onAnyChange, {
      debounceMs: 50,
    });

    fireCreate("/work/src/New.tsx");
    vi.advanceTimersByTime(50);
    expect(onAnyChange).toHaveBeenCalledTimes(1);

    fireDelete("/work/src/Old.tsx");
    vi.advanceTimersByTime(50);
    expect(onAnyChange).toHaveBeenCalledTimes(2);

    fireChange("/work/src/Edited.tsx");
    vi.advanceTimersByTime(50);
    expect(onAnyChange).toHaveBeenCalledTimes(3);

    watcher.dispose();
  });

  it("ignores changes inside node_modules / dist / .git / .next", () => {
    const onAnyChange = vi.fn();
    const watcher = new PlaygroundFileWatcher(onAnyChange, {
      debounceMs: 50,
    });

    fireChange("/work/node_modules/foo/dist/index.tsx");
    fireChange("/work/dist/build.tsx");
    fireChange("/work/.git/HEAD");
    fireChange("/work/.next/cache/x.tsx");

    vi.advanceTimersByTime(50);
    expect(onAnyChange).not.toHaveBeenCalled();

    fireChange("/work/src/Real.tsx");
    vi.advanceTimersByTime(50);
    expect(onAnyChange).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it("dispose() clears any pending timer so no callback fires after disposal", () => {
    const onAnyChange = vi.fn();
    const watcher = new PlaygroundFileWatcher(onAnyChange, {
      debounceMs: 100,
    });

    fireChange("/work/src/Foo.tsx");
    watcher.dispose();
    vi.advanceTimersByTime(200);
    expect(onAnyChange).not.toHaveBeenCalled();
  });
});
