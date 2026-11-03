// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ɵcreateThreadsDrawerActions,
  ɵfindChatInput,
  ɵgetThreadsDrawerElementProps,
  ɵtoDrawerThread,
} from "../threads-drawer";
import type {
  ɵThreadsDrawerCallbacks,
  ɵThreadsDrawerConfig,
} from "../threads-drawer";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function createThreads(overrides: { deleteThread?: () => Promise<void> } = {}) {
  return {
    startNewThread: vi.fn(),
    archiveThread: vi.fn(() => Promise.resolve()),
    unarchiveThread: vi.fn(() => Promise.resolve()),
    deleteThread: vi.fn(overrides.deleteThread ?? (() => Promise.resolve())),
    fetchMoreThreads: vi.fn(),
    refetchThreads: vi.fn(),
  };
}

function createActions({
  config = null,
  callbacks = {},
  threads = createThreads(),
}: {
  config?: ɵThreadsDrawerConfig | null;
  callbacks?: ɵThreadsDrawerCallbacks;
  threads?: ReturnType<typeof createThreads>;
} = {}) {
  const actions = ɵcreateThreadsDrawerActions({
    getThreads: () => threads,
    getConfig: () => config,
    getCallbacks: () => callbacks,
    getElement: () => null,
  });
  return { actions, threads };
}

describe("ɵtoDrawerThread", () => {
  it("keeps only the rendered fields", () => {
    expect(
      ɵtoDrawerThread({
        id: "t1",
        name: "Plan",
        archived: false,
        createdAt: "c",
        updatedAt: "u",
      }),
    ).toEqual({
      id: "t1",
      name: "Plan",
      archived: false,
      createdAt: "c",
      updatedAt: "u",
    });
  });
});

describe("ɵgetThreadsDrawerElementProps", () => {
  it("shows loading and never the locked view while the license is pending", () => {
    expect(
      ɵgetThreadsDrawerElementProps({
        loading: false,
        licensed: false,
        licensePending: true,
      }),
    ).toEqual({ loading: true, licensed: true });
  });

  it("passes settled values through", () => {
    expect(
      ɵgetThreadsDrawerElementProps({
        loading: false,
        licensed: false,
        licensePending: false,
      }),
    ).toEqual({ loading: false, licensed: false });
  });
});

describe("ɵfindChatInput", () => {
  it.each([
    [
      '<div data-testid="copilot-chat">',
      '<textarea data-testid="copilot-chat-textarea">',
    ],
    [
      '<div data-testid="copilot-chat-view">',
      '<textarea data-testid="copilot-chat-input-textarea">',
    ],
    ["<copilot-chat-view>", "<textarea copilotChatTextarea>"],
  ])(
    "finds the input inside the drawer's own chat (%s)",
    (container, input) => {
      const close = (tag: string) => `</${tag.slice(1).split(/[ >]/)[0]}>`;
      document.body.innerHTML =
        `<div><textarea data-testid="copilot-chat-textarea" id="other"></textarea></div>` +
        `${container}${input}${close(input)}<aside id="drawer"></aside>${close(container)}`;

      const found = ɵfindChatInput(document.getElementById("drawer"));

      expect(found?.id).not.toBe("other");
      expect(found?.tagName).toBe("TEXTAREA");
    },
  );

  it("falls back to any chat input in the document", () => {
    document.body.innerHTML =
      '<textarea data-testid="copilot-chat-textarea" id="only"></textarea>';

    expect(ɵfindChatInput(null)?.id).toBe("only");
  });
});

describe("ɵcreateThreadsDrawerActions", () => {
  it("makes a picked thread the explicit active thread without a callback", () => {
    const setActiveThreadId = vi.fn();
    const { actions } = createActions({ config: { setActiveThreadId } });

    actions.selectThread("t2");

    expect(setActiveThreadId).toHaveBeenCalledWith("t2", { explicit: true });
  });

  it("calls onThreadSelect instead of switching the chat", () => {
    const setActiveThreadId = vi.fn();
    const onThreadSelect = vi.fn();
    const { actions } = createActions({
      config: { setActiveThreadId },
      callbacks: { onThreadSelect },
    });

    actions.selectThread("t2");

    expect(onThreadSelect).toHaveBeenCalledWith("t2");
    expect(setActiveThreadId).not.toHaveBeenCalled();
  });

  it("starts a new chat thread after deleting the active thread", async () => {
    const startNewThread = vi.fn();
    const { actions, threads } = createActions({
      config: { threadId: "t1", startNewThread },
    });

    actions.remove("t1");
    await vi.waitFor(() => expect(startNewThread).toHaveBeenCalledOnce());
    expect(threads.startNewThread).toHaveBeenCalledOnce();
  });

  it("keeps the chat thread when another thread is deleted", async () => {
    const startNewThread = vi.fn();
    const { actions, threads } = createActions({
      config: { threadId: "t1", startNewThread },
    });

    actions.remove("t2");
    await vi.waitFor(() => expect(threads.deleteThread).toHaveBeenCalled());
    await Promise.resolve();

    expect(startNewThread).not.toHaveBeenCalled();
  });

  it("logs a failed delete instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { actions } = createActions({
      threads: createThreads({
        deleteThread: () => Promise.reject(new Error("nope")),
      }),
    });

    actions.remove("t1");

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "CopilotThreadsDrawer: deleteThread failed",
        new Error("nope"),
      ),
    );
  });

  it("retries the next page for a fetch-more failure, else the list", () => {
    const { actions, threads } = createActions();

    actions.retry("fetch-more");
    actions.retry("list");

    expect(threads.fetchMoreThreads).toHaveBeenCalledOnce();
    expect(threads.refetchThreads).toHaveBeenCalledOnce();
  });
});
