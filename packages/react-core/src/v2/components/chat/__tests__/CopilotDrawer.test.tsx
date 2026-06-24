import React, { useContext } from "react";
import { render, act } from "@testing-library/react";
import { test, expect, vi, beforeEach } from "vitest";

import { CopilotDrawer } from "../CopilotDrawer";
import { CopilotkitDrawer } from "@copilotkit/web-components";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../../providers/CopilotChatConfigurationProvider";
import {
  ThreadsProvider,
  ThreadsContext,
} from "../../../../context/threads-context";
import { useThreads as useThreadsList } from "../../../hooks/use-threads";
import { useLicenseContext } from "../../../providers/CopilotKitProvider";
import { randomUUID } from "@copilotkit/shared";

// --- Mocks --------------------------------------------------------------
// The drawer's list data + mutations come from the v2 useThreads hook, and the
// licensed flag from the license context. Both are mocked so the tests assert
// purely on the wrapper's binding behavior, not on a live runtime.
vi.mock("../../../hooks/use-threads", () => ({
  useThreads: vi.fn(),
}));
vi.mock("../../../providers/CopilotKitProvider", () => ({
  useLicenseContext: vi.fn(),
}));

const mockedUseThreadsList = vi.mocked(useThreadsList);
const mockedUseLicenseContext = vi.mocked(useLicenseContext);

type ThreadRecord = ReturnType<typeof useThreadsList>["threads"][number];

function sampleThreads(): ThreadRecord[] {
  return [
    {
      id: "t1",
      agentId: "a",
      name: "First",
      archived: false,
      createdAt: "2026-06-01",
      updatedAt: "2026-06-01",
    },
    {
      id: "t2",
      agentId: "a",
      name: "Second",
      archived: true,
      createdAt: "2026-06-02",
      updatedAt: "2026-06-02",
    },
  ];
}

type ThreadsHookValue = ReturnType<typeof useThreadsList>;

function makeThreadsHookValue(
  overrides: Partial<ThreadsHookValue> = {},
): ThreadsHookValue {
  return {
    threads: sampleThreads(),
    isLoading: false,
    error: null,
    hasMoreThreads: false,
    isFetchingMoreThreads: false,
    fetchMoreThreads: vi.fn(),
    renameThread: vi.fn(() => Promise.resolve()),
    archiveThread: vi.fn(() => Promise.resolve()),
    unarchiveThread: vi.fn(() => Promise.resolve()),
    deleteThread: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const checkFeature = vi.fn();

function makeLicenseValue(): ReturnType<typeof useLicenseContext> {
  return {
    status: null,
    license: null,
    checkFeature,
    getLimit: () => null,
  };
}

/**
 * Bridges the v1 ThreadsContext threadId into the v2 chat configuration the
 * same way the real `<CopilotKit>` provider does (`threadId={threadsState.threadId}`),
 * so reading `config.threadId` and writing via `ThreadsContext.setThreadId`
 * stay in sync inside the test harness.
 */
function ConfigBridge({
  isModalDefaultOpen,
  children,
}: {
  isModalDefaultOpen: boolean;
  children: React.ReactNode;
}) {
  const threadsState = useContext(ThreadsContext)!;
  return (
    <CopilotChatConfigurationProvider
      threadId={threadsState.threadId}
      isModalDefaultOpen={isModalDefaultOpen}
    >
      {children}
    </CopilotChatConfigurationProvider>
  );
}

function ModalStateReadout() {
  const config = useCopilotChatConfiguration();
  return <div data-testid="modalState">{config?.modalState}</div>;
}

function ThreadIdReadout() {
  const config = useCopilotChatConfiguration();
  return <div data-testid="threadId">{config?.threadId}</div>;
}

function setup(opts: {
  licensed?: boolean;
  threadsValue?: Partial<ThreadsHookValue>;
  modalDefaultOpen?: boolean;
  drawer?: React.ReactNode;
}) {
  const licensed = opts.licensed ?? true;
  checkFeature.mockReturnValue(licensed);
  mockedUseLicenseContext.mockReturnValue(makeLicenseValue());
  const threadsValue = makeThreadsHookValue(opts.threadsValue);
  mockedUseThreadsList.mockReturnValue(threadsValue);

  const utils = render(
    <ThreadsProvider>
      <ConfigBridge isModalDefaultOpen={opts.modalDefaultOpen ?? true}>
        {opts.drawer ?? <CopilotDrawer />}
        <ModalStateReadout />
        <ThreadIdReadout />
      </ConfigBridge>
    </ThreadsProvider>,
  );

  const element = document.querySelector(
    "copilotkit-drawer",
  ) as CopilotkitDrawer;

  return { ...utils, element, threadsValue };
}

function dispatch<T>(element: Element, type: string, detail?: T): void {
  act(() => {
    element.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

test("renders the copilotkit-drawer custom element", () => {
  const { element } = setup({});
  expect(element).toBeInstanceOf(CopilotkitDrawer);
});

test("assigns the thread list as an element property", () => {
  const { element } = setup({});
  expect(element.threads.map((thread) => thread.id)).toEqual(["t1", "t2"]);
  // archived flag is projected through
  expect(element.threads[1]!.archived).toBe(true);
});

test("assigns the active threadId from the chat configuration", () => {
  const { element } = setup({});
  // ThreadsProvider mints a UUID; the wrapper reflects it as activeThreadId.
  const renderedThreadId = document.querySelector(
    '[data-testid="threadId"]',
  )!.textContent;
  expect(element.activeThreadId).toBe(renderedThreadId);
  expect(typeof element.activeThreadId).toBe("string");
});

test("assigns the licensed flag from checkFeature('threads')", () => {
  const { element } = setup({ licensed: true });
  expect(checkFeature).toHaveBeenCalledWith("threads");
  expect(element.licensed).toBe(true);
});

test("passes licensed=false when the feature is unlicensed", () => {
  const { element } = setup({ licensed: false });
  expect(element.licensed).toBe(false);
});

test("reflects loading and error from useThreads", () => {
  const { element } = setup({
    threadsValue: { isLoading: true, error: new Error("boom") },
  });
  expect(element.loading).toBe(true);
  expect(element.error).toBe("boom");
});

test("suppresses the runtime error on the element when unlicensed", () => {
  // An unlicensed drawer shows only the built-in upsell. useThreads still
  // surfaces a runtime/endpoint error (e.g. no runtimeUrl configured), but the
  // wrapper must not forward it — otherwise a hard error banner could show
  // alongside the upsell.
  const { element } = setup({
    licensed: false,
    threadsValue: { error: new Error("Runtime URL is not configured") },
  });

  expect(element.licensed).toBe(false);
  expect(element.error).toBe(null);
});

test("open reflects modalState === 'threads'", () => {
  const { element } = setup({ modalDefaultOpen: true });
  // default open maps to "chat", so the drawer is closed initially
  expect(element.open).toBe(false);

  dispatch(element, "open-change", { open: true });
  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("threads");
  expect(element.open).toBe(true);
});

test("thread-selected sets the active thread and returns to chat", () => {
  const { element } = setup({});

  dispatch(element, "thread-selected", { id: "t2" });

  expect(document.querySelector('[data-testid="threadId"]')!.textContent).toBe(
    "t2",
  );
  expect(element.activeThreadId).toBe("t2");
  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("chat");
});

test("new-thread mints a fresh thread id and returns to chat", () => {
  const { element } = setup({});
  const before = document.querySelector(
    '[data-testid="threadId"]',
  )!.textContent;

  // setupTests pins randomUUID to the constant "mock-thread-id", which is also
  // the initial minted thread id. Override it for this dispatch so the
  // freshly-minted id is observably different from `before`.
  vi.mocked(randomUUID).mockReturnValueOnce("fresh-thread-id");
  dispatch(element, "new-thread", undefined);

  const after = document.querySelector('[data-testid="threadId"]')!.textContent;
  expect(after).toBe("fresh-thread-id");
  expect(after).not.toBe(before);
  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("chat");
});

test("archive event calls archiveThread", () => {
  const { element, threadsValue } = setup({});
  dispatch(element, "archive", { id: "t1" });
  expect(threadsValue.archiveThread).toHaveBeenCalledWith("t1");
});

test("unarchive event calls unarchiveThread", () => {
  const { element, threadsValue } = setup({});
  dispatch(element, "unarchive", { id: "t2" });
  expect(threadsValue.unarchiveThread).toHaveBeenCalledWith("t2");
});

test("delete event calls deleteThread", () => {
  const { element, threadsValue } = setup({});
  dispatch(element, "delete", { id: "t1" });
  expect(threadsValue.deleteThread).toHaveBeenCalledWith("t1");
});

test("filter-change updates the element's filter property", () => {
  const { element } = setup({});
  expect(element.filter).toBe("active");

  dispatch(element, "filter-change", { filter: "all" });
  expect(element.filter).toBe("all");
});

test("open-change(false) returns to chat when chat was the prior surface", () => {
  const { element } = setup({ modalDefaultOpen: true });
  dispatch(element, "open-change", { open: true });
  expect(element.open).toBe(true);

  dispatch(element, "open-change", { open: false });
  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("chat");
  expect(element.open).toBe(false);
});

test("open-change(false) returns to none when the surface was collapsed", () => {
  // Surface starts collapsed ("none"). Opening the drawer must not strand the
  // user on the chat panel when they dismiss it.
  const { element } = setup({ modalDefaultOpen: false });
  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("none");

  dispatch(element, "open-change", { open: true });
  expect(element.open).toBe(true);
  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("threads");

  dispatch(element, "open-change", { open: false });
  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("none");
  expect(element.open).toBe(false);
});

test("thread-selected still returns to chat even from a collapsed surface", () => {
  // The mobile drill-in path is preserved: selecting a thread lands on chat
  // regardless of the prior surface, unlike dismissing the drawer.
  const { element } = setup({ modalDefaultOpen: false });

  dispatch(element, "open-change", { open: true });
  dispatch(element, "thread-selected", { id: "t2" });

  expect(
    document.querySelector('[data-testid="modalState"]')!.textContent,
  ).toBe("chat");
});

test("controlled threadId + onThreadSelect bypasses the platform setter", () => {
  const onThreadSelect = vi.fn();
  const { element } = setup({
    drawer: (
      <CopilotDrawer threadId="controlled-1" onThreadSelect={onThreadSelect} />
    ),
  });

  expect(element.activeThreadId).toBe("controlled-1");

  dispatch(element, "thread-selected", { id: "t2" });
  expect(onThreadSelect).toHaveBeenCalledWith("t2");
  // The controlled threadId prop wins — the rendered config threadId is
  // unaffected by the selection (caller owns routing).
  expect(element.activeThreadId).toBe("controlled-1");
});

test("controlled threadId without onThreadSelect no-ops platform routing and warns", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { element } = setup({
    drawer: <CopilotDrawer threadId="controlled-1" />,
  });

  expect(element.activeThreadId).toBe("controlled-1");
  const before = document.querySelector(
    '[data-testid="threadId"]',
  )!.textContent;

  dispatch(element, "thread-selected", { id: "t2" });

  // The platform thread is NOT mutated, and the controlled highlight stays put.
  const after = document.querySelector('[data-testid="threadId"]')!.textContent;
  expect(after).toBe(before);
  expect(element.activeThreadId).toBe("controlled-1");
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("controlled `threadId`"),
  );

  warn.mockRestore();
});

test("controlled new-thread without onThreadSelect does not write the platform setter", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { element } = setup({
    drawer: <CopilotDrawer threadId="controlled-1" />,
  });
  const before = document.querySelector(
    '[data-testid="threadId"]',
  )!.textContent;

  // A distinct minted id makes the no-op observable: were the platform setter
  // written, the config threadId would flip to this value.
  vi.mocked(randomUUID).mockReturnValueOnce("fresh-thread-id");
  dispatch(element, "new-thread", undefined);

  expect(document.querySelector('[data-testid="threadId"]')!.textContent).toBe(
    before,
  );
  expect(
    document.querySelector('[data-testid="threadId"]')!.textContent,
  ).not.toBe("fresh-thread-id");
  expect(element.activeThreadId).toBe("controlled-1");

  warn.mockRestore();
});

test("surfaces a swallowed archive rejection via console.warn", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const failure = new Error("archive failed on server");
  const { element } = setup({
    threadsValue: { archiveThread: vi.fn(() => Promise.reject(failure)) },
  });

  dispatch(element, "archive", { id: "t1" });
  // Let the rejected mutation promise settle so the .catch handler runs.
  await act(async () => {
    await Promise.resolve();
  });

  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('archive thread "t1" failed'),
    failure,
  );

  warn.mockRestore();
});

test("does not fetch threads when the feature is unlicensed", () => {
  setup({ licensed: false });

  // The list hook is invoked (hooks cannot be conditional) but must be told to
  // skip the request via `enabled: false`, so no list/subscribe is issued.
  expect(mockedUseThreadsList).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false }),
  );
});

test("fetches threads when the feature is licensed", () => {
  setup({ licensed: true });

  expect(mockedUseThreadsList).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: true }),
  );
});

test("removes event listeners on unmount", () => {
  const { element, threadsValue, unmount } = setup({});
  unmount();
  // After unmount the element is detached; dispatching must not call handlers.
  element.dispatchEvent(new CustomEvent("archive", { detail: { id: "t1" } }));
  expect(threadsValue.archiveThread).not.toHaveBeenCalled();
});
