import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { test, expect, vi, beforeEach } from "vitest";
import { COPILOTKIT_THREADS_DRAWER_TAG } from "@copilotkit/web-components/threads-drawer";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
import { CopilotThreadsDrawer } from "../CopilotThreadsDrawer";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../../providers/CopilotChatConfigurationProvider";
import type { Thread, UseThreadsInput } from "../../../hooks/use-threads";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mutations = {
  archiveThread: vi.fn(() => Promise.resolve()),
  unarchiveThread: vi.fn(() => Promise.resolve()),
  deleteThread: vi.fn(() => Promise.resolve()),
  renameThread: vi.fn(() => Promise.resolve()),
  fetchMoreThreads: vi.fn(),
  refetchThreads: vi.fn(),
  startNewThread: vi.fn(),
};

const useThreadsMock = vi.fn();

vi.mock("../../../hooks/use-threads", () => ({
  useThreads: (input: UseThreadsInput) => useThreadsMock(input),
}));

const licenseMock = vi.fn();

vi.mock("../../../providers/CopilotKitProvider", () => ({
  useLicenseContext: () => licenseMock(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleThreads: Thread[] = [
  {
    id: "t1",
    agentId: "default",
    name: "First",
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastRunAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "t2",
    agentId: "default",
    name: "Second",
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

type ThreadsOverrides = Partial<{
  threads: Thread[];
  isLoading: boolean;
  error: Error | null;
  listError: Error | null;
  fetchMoreError: Error | null;
  hasMoreThreads: boolean;
  isFetchingMoreThreads: boolean;
  isMutating: boolean;
}>;

function setupThreads(overrides: ThreadsOverrides = {}) {
  // `error` folds config + list errors; `listError` is the genuine list-load
  // error the drawer renders. When a test sets only `listError` we also reflect
  // it into `error` (a list error appears in both channels). When a test sets
  // only `error` (a config/runtime error) we leave `listError` null so the
  // drawer suppresses it.
  const listError =
    overrides.listError !== undefined ? overrides.listError : null;
  useThreadsMock.mockImplementation(() => ({
    threads: overrides.threads ?? sampleThreads,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? listError,
    listError,
    fetchMoreError: overrides.fetchMoreError ?? null,
    hasMoreThreads: overrides.hasMoreThreads ?? false,
    isFetchingMoreThreads: overrides.isFetchingMoreThreads ?? false,
    isMutating: overrides.isMutating ?? false,
    ...mutations,
  }));
}

function setLicensed(licensed: boolean) {
  licenseMock.mockReturnValue({
    status: licensed ? "valid" : "none",
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  });
}

/** Reads drawer registration + open state for assertions. */
function ConfigProbe() {
  const config = useCopilotChatConfiguration();
  return (
    <div
      data-testid="config-probe"
      data-registered={String(config?.drawerRegistered)}
      data-open={String(config?.drawerOpen)}
      data-thread={config?.threadId}
      data-explicit={String(config?.hasExplicitThreadId)}
    />
  );
}

/** Toggles drawerOpen from within the provider so we can drive the element. */
function OpenToggle() {
  const config = useCopilotChatConfiguration();
  return (
    <button
      data-testid="open-toggle"
      onClick={() => config?.setDrawerOpen(true)}
    />
  );
}

function getElement(): CopilotKitThreadsDrawerElement {
  const el = document.querySelector(COPILOTKIT_THREADS_DRAWER_TAG);
  if (!el) throw new Error("drawer element not found");
  return el as CopilotKitThreadsDrawerElement;
}

function dispatch(type: string, detail: unknown = {}) {
  act(() => {
    getElement().dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  });
}

async function renderDrawer(
  props: Parameters<typeof CopilotThreadsDrawer>[0] = {},
) {
  const result = render(
    <CopilotChatConfigurationProvider threadId="t1">
      <ConfigProbe />
      <OpenToggle />
      <CopilotThreadsDrawer {...props} />
    </CopilotChatConfigurationProvider>,
  );
  // The element registers + renders only after the client-mount effect.
  await waitFor(() =>
    expect(
      document.querySelector(COPILOTKIT_THREADS_DRAWER_TAG),
    ).not.toBeNull(),
  );
  return result;
}

/**
 * Renders the drawer under an UNCONTROLLED provider (no `threadId` prop) so the
 * provider's imperative active-thread setters are live — the bare,
 * callback-free topology where the drawer drives the chat configuration itself.
 */
async function renderUncontrolledDrawer(
  props: Parameters<typeof CopilotThreadsDrawer>[0] = {},
) {
  const result = render(
    <CopilotChatConfigurationProvider>
      <ConfigProbe />
      <CopilotThreadsDrawer {...props} />
    </CopilotChatConfigurationProvider>,
  );
  await waitFor(() =>
    expect(
      document.querySelector(COPILOTKIT_THREADS_DRAWER_TAG),
    ).not.toBeNull(),
  );
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  setLicensed(true);
  setupThreads();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("feeds domain data to the element as properties", async () => {
  setupThreads({ hasMoreThreads: true, isFetchingMoreThreads: true });

  await renderDrawer();
  const el = getElement();

  expect(el.threads.map((t) => t.id)).toEqual(["t1", "t2"]);
  expect(el.loading).toBe(false);
  expect(el.error).toBeNull();
  expect(el.activeThreadId).toBe("t1");
  expect(el.licensed).toBe(true);
  expect(el.hasMore).toBe(true);
  expect(el.fetchingMore).toBe(true);
});

test("maps a genuine list-load error to the element's error string", async () => {
  setupThreads({ listError: new Error("boom") });

  await renderDrawer();

  expect(getElement().error).toBe("boom");
});

test("forwards fetchMoreError to the element's fetchMoreError property without touching error", async () => {
  setupThreads({ fetchMoreError: new Error("couldn't load more") });

  await renderDrawer();
  const el = getElement();

  expect(el.fetchMoreError).toBe("couldn't load more");
  // The dedicated fetch-more channel must NOT bleed into the initial-list error.
  expect(el.error).toBeNull();
});

test("sets the element's label when the label prop is provided", async () => {
  await renderDrawer({ label: "History" });

  expect(getElement().label).toBe("History");
});

test("leaves the element's default label when the label prop is omitted", async () => {
  await renderDrawer();

  expect(getElement().label).toBe("Threads");
});

test("sets the element's licenseUrl when the licenseUrl prop is provided", async () => {
  await renderDrawer({ licenseUrl: "https://example.com/upgrade" });

  expect(getElement().licenseUrl).toBe("https://example.com/upgrade");
});

test("leaves the element's default licenseUrl when the prop is omitted", async () => {
  await renderDrawer();

  expect(getElement().licenseUrl).toBe(
    "https://docs.copilotkit.ai/intelligence",
  );
});

test("forwards the limit prop to useThreads", async () => {
  await renderDrawer({ limit: 20 });

  expect(useThreadsMock).toHaveBeenCalledWith(
    expect.objectContaining({ limit: 20 }),
  );
});

test("omits limit from useThreads when the prop is not set", async () => {
  await renderDrawer();

  expect(useThreadsMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ limit: expect.anything() }),
  );
});

test("routes the element's load-more event to fetchMoreThreads", async () => {
  await renderDrawer();

  dispatch("load-more");

  expect(mutations.fetchMoreThreads).toHaveBeenCalled();
});

test("suppresses config/runtime-setup errors from the end-user error surface", async () => {
  // A licensed drawer with no runtime URL produces a developer/config error in
  // the hook's combined `error` channel, but `listError` is null — the drawer
  // must NOT leak the developer-facing message into the element's error UI.
  setupThreads({
    error: new Error("Runtime URL is not configured"),
    listError: null,
  });

  await renderDrawer();

  expect(getElement().error).toBeNull();
});

test("registers the drawer with the chat configuration", async () => {
  await renderDrawer();

  expect(screen.getByTestId("config-probe").dataset.registered).toBe("true");
});

test("de-registers the drawer on unmount", async () => {
  const { rerender } = await renderDrawer();

  rerender(
    <CopilotChatConfigurationProvider threadId="t1">
      <ConfigProbe />
    </CopilotChatConfigurationProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("config-probe").dataset.registered).toBe("false"),
  );
});

test("thread-selected focuses the chat input scoped to this drawer's own chat", async () => {
  // Two chats on the page. The drawer shares a container with the SECOND chat;
  // selecting a thread must focus that chat's input, not the first in DOM order.
  const onThreadSelect = vi.fn();
  render(
    <>
      <div data-testid="copilot-chat">
        <textarea data-testid="copilot-chat-textarea" id="first" />
      </div>
      <div data-testid="copilot-chat">
        <textarea data-testid="copilot-chat-textarea" id="second" />
        <CopilotThreadsDrawer onThreadSelect={onThreadSelect} />
      </div>
    </>,
  );
  await waitFor(() =>
    expect(
      document.querySelector(COPILOTKIT_THREADS_DRAWER_TAG),
    ).not.toBeNull(),
  );

  dispatch("thread-selected", { threadId: "t2" });

  expect(document.activeElement?.id).toBe("second");
});

test("thread-selected routes to onThreadSelect", async () => {
  const onThreadSelect = vi.fn();
  await renderDrawer({ onThreadSelect });

  dispatch("thread-selected", { threadId: "t2" });

  expect(onThreadSelect).toHaveBeenCalledWith("t2");
});

test("new-thread calls startNewThread AND onNewThread (non-explicit reset)", async () => {
  const onNewThread = vi.fn();
  await renderDrawer({ onNewThread });

  dispatch("new-thread", {});

  expect(mutations.startNewThread).toHaveBeenCalledTimes(1);
  expect(onNewThread).toHaveBeenCalledTimes(1);
});

test("thread-selected (no callback) drives the provider's active thread explicitly", async () => {
  await renderUncontrolledDrawer();

  dispatch("thread-selected", { threadId: "t2" });

  await waitFor(() => {
    expect(screen.getByTestId("config-probe").dataset.thread).toBe("t2");
    expect(screen.getByTestId("config-probe").dataset.explicit).toBe("true");
  });
});

test("new-thread (no callback) resets the provider to a fresh non-explicit thread (welcome path)", async () => {
  await renderUncontrolledDrawer();

  // Select first so the provider is explicit, then assert "+ New" flips it back
  // to non-explicit (randomUUID is globally stubbed, so assert explicitness).
  dispatch("thread-selected", { threadId: "t2" });
  await waitFor(() =>
    expect(screen.getByTestId("config-probe").dataset.explicit).toBe("true"),
  );

  dispatch("new-thread", {});

  await waitFor(() => {
    expect(screen.getByTestId("config-probe").dataset.thread).toBeTruthy();
    expect(screen.getByTestId("config-probe").dataset.explicit).toBe("false");
  });
  // The core thread store is still reset regardless of callback presence.
  expect(mutations.startNewThread).toHaveBeenCalledTimes(1);
});

test("onThreadSelect, when provided, is preferred over the provider", async () => {
  const onThreadSelect = vi.fn();
  await renderUncontrolledDrawer({ onThreadSelect });

  dispatch("thread-selected", { threadId: "t2" });

  expect(onThreadSelect).toHaveBeenCalledWith("t2");
  // The provider's active thread is NOT driven when the host takes control.
  expect(screen.getByTestId("config-probe").dataset.thread).not.toBe("t2");
});

test("onNewThread, when provided, is preferred over the provider's startNewThread", async () => {
  const onNewThread = vi.fn();
  await renderUncontrolledDrawer({ onNewThread });

  const before = screen.getByTestId("config-probe").dataset.thread;

  dispatch("new-thread", {});

  expect(onNewThread).toHaveBeenCalledTimes(1);
  expect(mutations.startNewThread).toHaveBeenCalledTimes(1);
  // Provider's threadId is left to the host callback (unchanged here).
  expect(screen.getByTestId("config-probe").dataset.thread).toBe(before);
});

test("archive routes to archiveThread", async () => {
  await renderDrawer();

  dispatch("archive", { threadId: "t2" });

  expect(mutations.archiveThread).toHaveBeenCalledWith("t2");
});

test("unarchive routes to unarchiveThread", async () => {
  await renderDrawer();

  dispatch("unarchive", { threadId: "t2" });

  expect(mutations.unarchiveThread).toHaveBeenCalledWith("t2");
});

test("delete of a non-active thread does NOT reset to a new thread", async () => {
  const onNewThread = vi.fn();
  await renderDrawer({ onNewThread });

  dispatch("delete", { threadId: "t2" });

  expect(mutations.deleteThread).toHaveBeenCalledWith("t2");
  await waitFor(() => expect(mutations.deleteThread).toHaveReturned());
  expect(mutations.startNewThread).not.toHaveBeenCalled();
  expect(onNewThread).not.toHaveBeenCalled();
});

test("delete of the ACTIVE thread resets to a fresh non-explicit thread", async () => {
  const onNewThread = vi.fn();
  await renderDrawer({ onNewThread }); // activeThreadId is "t1"

  dispatch("delete", { threadId: "t1" });

  expect(mutations.deleteThread).toHaveBeenCalledWith("t1");
  await waitFor(() => {
    expect(mutations.startNewThread).toHaveBeenCalledTimes(1);
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });
});

test("delete renders exactly the store's threads (no wrapper-level removal bookkeeping)", async () => {
  // The store owns optimistic removal + rollback; the wrapper holds no removal
  // set of its own. The element therefore always reflects the `threads` the
  // hook hands it — here both sample threads remain rendered after a delete is
  // dispatched (the store, mocked, does not mutate its list).
  await renderDrawer();

  dispatch("delete", { threadId: "t2" });

  expect(mutations.deleteThread).toHaveBeenCalledWith("t2");
  await waitFor(() => expect(mutations.deleteThread).toHaveReturned());
  expect(getElement().threads.map((t) => t.id)).toEqual(["t1", "t2"]);
});

test("delete failure does not throw and leaves the rendered list intact", async () => {
  // Create the rejected promise lazily at call time (not eagerly here) so it is
  // never an unhandled rejection during the `await renderDrawer()` window before
  // the delete handler attaches its `.catch`.
  mutations.deleteThread.mockImplementationOnce(() =>
    Promise.reject(new Error("nope")),
  );
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  await renderDrawer();

  dispatch("delete", { threadId: "t2" });

  await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  expect(getElement().threads.map((t) => t.id)).toEqual(["t1", "t2"]);
  errorSpy.mockRestore();
});

test("filter-change refetches threads", async () => {
  await renderDrawer();

  dispatch("filter-change", { filter: "all" });

  expect(mutations.refetchThreads).toHaveBeenCalledTimes(1);
});

test("retry (initial) refetches; retry (fetch-more) fetches more", async () => {
  await renderDrawer();

  dispatch("retry", { scope: "initial" });
  expect(mutations.refetchThreads).toHaveBeenCalledTimes(1);
  expect(mutations.fetchMoreThreads).not.toHaveBeenCalled();

  dispatch("retry", { scope: "fetch-more" });
  expect(mutations.fetchMoreThreads).toHaveBeenCalledTimes(1);
});

test("licensed event routes to onLicensed", async () => {
  const onLicensed = vi.fn();
  await renderDrawer({ onLicensed });

  dispatch("licensed", {});

  expect(onLicensed).toHaveBeenCalledTimes(1);
});

test("open-change drives the chat configuration drawerOpen", async () => {
  await renderDrawer();

  expect(screen.getByTestId("config-probe").dataset.open).toBe("false");

  dispatch("open-change", { open: true });

  await waitFor(() =>
    expect(screen.getByTestId("config-probe").dataset.open).toBe("true"),
  );
});

test("drawerOpen reflects onto the element's open property", async () => {
  await renderDrawer();

  expect(getElement().open).toBe(false);

  act(() => {
    screen.getByTestId("open-toggle").click();
  });

  await waitFor(() => expect(getElement().open).toBe(true));
});

test("two-pronged license: no license configured shows the locked view (licensed=false)", async () => {
  setLicensed(false); // status "none"
  await renderDrawer();

  expect(getElement().licensed).toBe(false);
});

test("two-pronged license: expired/invalid status is unlicensed even though checkFeature is permissive", async () => {
  licenseMock.mockReturnValue({
    status: "expired",
    license: null,
    checkFeature: () => false,
    getLimit: () => null,
  });

  await renderDrawer();

  expect(getElement().licensed).toBe(false);
});

test("unlicensed drawer skips the thread fetch (enabled=false)", async () => {
  setLicensed(false);
  await renderDrawer();

  const lastInput = useThreadsMock.mock.calls.at(-1)?.[0] as UseThreadsInput;
  expect(lastInput.enabled).toBe(false);
});

test("licensed drawer enables the thread fetch (enabled=true)", async () => {
  setLicensed(true);
  await renderDrawer();

  const lastInput = useThreadsMock.mock.calls.at(-1)?.[0] as UseThreadsInput;
  expect(lastInput.enabled).toBe(true);
});

test("pending license (status null) shows loading, never the locked view", async () => {
  // Before the runtime reports a license, `status` is null. The drawer must NOT
  // flash (or strand) the locked view during this window: it renders as licensed
  // (so `_renderBody` skips the locked view) with loading forced on, and holds the
  // fetch until the status resolves.
  licenseMock.mockReturnValue({
    status: null,
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  });

  await renderDrawer();

  expect(getElement().licensed).toBe(true);
  expect(getElement().loading).toBe(true);
  const lastInput = useThreadsMock.mock.calls.at(-1)?.[0] as UseThreadsInput;
  expect(lastInput.enabled).toBe(false);
});

test('projects per-row content into slot="row:{id}" when renderRow is provided', async () => {
  await renderDrawer({
    renderRow: (thread) => <span data-row={thread.id}>{thread.name}</span>,
  });

  const projected = document.querySelector('[slot="row:t1"]');
  expect(projected).not.toBeNull();
  expect(projected?.querySelector('[data-row="t1"]')).not.toBeNull();
});

test("provider-less drawer starts CLOSED (does not render stuck-open)", async () => {
  // No surrounding CopilotChatConfigurationProvider: the wrapper falls back to
  // its own local open-state, which starts closed (matching the provider's own
  // `false` default) rather than being forced permanently open.
  render(<CopilotThreadsDrawer />);
  await waitFor(() =>
    expect(
      document.querySelector(COPILOTKIT_THREADS_DRAWER_TAG),
    ).not.toBeNull(),
  );

  expect(getElement().open).toBe(false);
});

test("provider-less drawer can be opened and then closed via open-change", async () => {
  // The element's open-change event must drive the wrapper's local open-state in
  // both directions even with no provider — previously the change was a silent
  // no-op and the drawer could never close.
  render(<CopilotThreadsDrawer />);
  await waitFor(() =>
    expect(
      document.querySelector(COPILOTKIT_THREADS_DRAWER_TAG),
    ).not.toBeNull(),
  );

  dispatch("open-change", { open: true });
  await waitFor(() => expect(getElement().open).toBe(true));

  dispatch("open-change", { open: false });
  await waitFor(() => expect(getElement().open).toBe(false));
});

test("forwards recentLabel to the element as recent-label", async () => {
  await renderDrawer({ recentLabel: "History" });

  expect(getElement().getAttribute("recent-label")).toBe("History");
});

test("omits the recent-label attribute when the prop is not set", async () => {
  await renderDrawer();

  expect(getElement().hasAttribute("recent-label")).toBe(false);
});

test("sets the element's collapsible property to false when collapsible={false}", async () => {
  await renderDrawer({ collapsible: false });

  expect(
    (getElement() as unknown as { collapsible: boolean }).collapsible,
  ).toBe(false);
});

test("leaves the element's collapsible property untouched when the prop is omitted", async () => {
  await renderDrawer();

  // The wrapper never assigns the property, so the element keeps its own
  // built-in default of `true` (mirrors the default-true `licensed` field).
  expect(
    (getElement() as unknown as { collapsible?: boolean }).collapsible,
  ).toBe(true);
});

test("surfaces the element's collapse-change event to onCollapseChange with the collapsed state", async () => {
  const onCollapseChange = vi.fn();
  await renderDrawer({ onCollapseChange });

  dispatch("collapse-change", { collapsed: true });

  expect(onCollapseChange).toHaveBeenCalledWith(true);
});

test("renders nothing during SSR (no element, no hydration mismatch)", () => {
  // Server render runs no effects, so the client-only mount flag stays false
  // and the element is never emitted — matching the empty initial client
  // render and avoiding a hydration mismatch / layout shift.
  const html = renderToString(
    <CopilotChatConfigurationProvider threadId="t1">
      <CopilotThreadsDrawer />
    </CopilotChatConfigurationProvider>,
  );

  expect(html).not.toContain(COPILOTKIT_THREADS_DRAWER_TAG);
});
