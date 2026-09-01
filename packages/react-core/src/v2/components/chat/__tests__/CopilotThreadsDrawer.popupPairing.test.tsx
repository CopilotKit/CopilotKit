/**
 * Documents-as-tests for the Threads Drawer beside a CopilotPopup (OSS-1093).
 *
 * The drawer resolves the active thread from the surrounding
 * `CopilotChatConfigurationProvider` (`configuration?.threadId`) and publishes a
 * selection back through `configuration?.setActiveThreadId`. `CopilotChat` — and
 * therefore `CopilotPopup`, which wraps it — always mints its OWN nested
 * configuration provider. So the drawer and the popup share an active thread
 * only when both sit under one common provider: the nested provider inherits
 * `parentConfig.threadId` and proxies its setter to the top-most owner.
 *
 * As bare siblings with no shared provider the drawer's `configuration` is
 * `null`, both calls optional-chain away, and selecting a row is a SILENT no-op
 * — the drawer renders but never tracks the conversation the user is having.
 * That is the failure the docs must steer developers away from, so it is
 * asserted here rather than described.
 */
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { test, expect, vi, beforeEach } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";
import { COPILOTKIT_THREADS_DRAWER_TAG } from "@copilotkit/web-components/threads-drawer";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
import { CopilotThreadsDrawer } from "../CopilotThreadsDrawer";
import { CopilotPopup } from "../CopilotPopup";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../../providers/CopilotChatConfigurationProvider";
import type { Thread, UseThreadsInput } from "../../../hooks/use-threads";
import type CopilotChatInput from "../CopilotChatInput";
import type { CopilotChatInputProps } from "../CopilotChatInput";

// --- mocks -----------------------------------------------------------------

const useThreadsMock = vi.fn();
vi.mock("../../../hooks/use-threads", () => ({
  useThreads: (input: UseThreadsInput) => useThreadsMock(input),
}));

// Keep the REAL CopilotKitProvider (the popup needs a working agent context);
// override only the license read so the drawer renders its list rather than the
// locked view.
vi.mock("../../../providers/CopilotKitProvider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../providers/CopilotKitProvider")
    >();
  return {
    ...actual,
    useLicenseContext: () => ({
      status: "valid",
      license: null,
      checkFeature: () => true,
      getLimit: () => null,
    }),
  };
});

const sampleThreads: Thread[] = [
  {
    id: "t1",
    agentId: "default",
    name: "First",
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
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

class MockAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  clone(): MockAgent {
    const cloned = new MockAgent();
    cloned.agentId = this.agentId;
    (cloned as unknown as { subject: Subject<BaseEvent> }).subject =
      this.subject;
    return cloned;
  }
  async detachActiveRun(): Promise<void> {}
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

/**
 * Rendered through the popup's `input` slot, so it lives INSIDE the chat
 * subtree — i.e. inside the nested provider `CopilotChat` mints. Reports the
 * thread the popup's chat is actually bound to.
 */
function PopupThreadProbe(_props: CopilotChatInputProps) {
  const config = useCopilotChatConfiguration();
  return (
    <div data-testid="popup-thread" data-thread={config?.threadId ?? "none"} />
  );
}

const asInput = (c: typeof PopupThreadProbe) =>
  c as unknown as typeof CopilotChatInput;

function getDrawerElement(): CopilotKitThreadsDrawerElement {
  const el = document.querySelector(COPILOTKIT_THREADS_DRAWER_TAG);
  if (!el) throw new Error("drawer element not found");
  return el as CopilotKitThreadsDrawerElement;
}

function selectThread(threadId: string) {
  act(() => {
    getDrawerElement().dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId },
        bubbles: true,
        composed: true,
      }),
    );
  });
}

const popupThreadId = () =>
  screen.getByTestId("popup-thread").getAttribute("data-thread");

beforeEach(() => {
  useThreadsMock.mockImplementation(() => ({
    threads: sampleThreads,
    isLoading: false,
    error: null,
    listError: null,
    fetchMoreError: null,
    hasMoreThreads: false,
    isFetchingMoreThreads: false,
    isMutating: false,
    archiveThread: vi.fn(() => Promise.resolve()),
    unarchiveThread: vi.fn(() => Promise.resolve()),
    deleteThread: vi.fn(() => Promise.resolve()),
    renameThread: vi.fn(() => Promise.resolve()),
    fetchMoreThreads: vi.fn(),
    refetchThreads: vi.fn(),
    startNewThread: vi.fn(),
  }));
});

test("a shared CopilotChatConfigurationProvider makes the popup follow the drawer's selection", async () => {
  const agent = new MockAgent();

  render(
    <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
      <CopilotChatConfigurationProvider>
        <CopilotThreadsDrawer />
        <CopilotPopup defaultOpen input={asInput(PopupThreadProbe)} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("popup-thread")).toBeTruthy());

  // Fresh mount: the provider mints a client-side UUID, so the popup is on some
  // thread but not one from the list (the drawer highlights no row).
  const initial = popupThreadId();
  expect(initial).not.toBe("t2");
  expect(getDrawerElement().activeThreadId).toBe(initial);

  selectThread("t2");

  await waitFor(() => expect(popupThreadId()).toBe("t2"));
  // ...and the drawer highlights the row it just published.
  expect(getDrawerElement().activeThreadId).toBe("t2");
});

test("without a shared provider the drawer renders but the popup never follows it", async () => {
  const agent = new MockAgent();

  render(
    <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
      {/* No CopilotChatConfigurationProvider: the drawer's configuration is
          null and the popup's nested provider has no parent to inherit from. */}
      <CopilotThreadsDrawer />
      <CopilotPopup defaultOpen input={asInput(PopupThreadProbe)} />
    </CopilotKitProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("popup-thread")).toBeTruthy());

  const before = popupThreadId();
  expect(getDrawerElement().activeThreadId).toBeNull();

  selectThread("t2");

  // The selection is a silent no-op across the boundary.
  expect(popupThreadId()).toBe(before);
  expect(getDrawerElement().activeThreadId).toBeNull();
});
