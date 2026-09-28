import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningProviderProps } from "@copilotkit/learning/react";
import type { ProductInteractionEvent } from "@copilotkit/learning";
import { CopilotKitLearningProvider } from "../CopilotKitLearningProvider";
import { useLearningThread } from "../../hooks/use-learning-thread";
import { useCopilotKit } from "../../context";
import type * as ContextModule from "../../context";
import { createLearningThreadRegistry } from "../../lib/learning-thread-registry";

const mocks = vi.hoisted(() => ({
  capture: vi.fn<(props: LearningProviderProps) => void>(),
  context: vi.fn(),
}));
vi.mock("@copilotkit/learning/react", () => ({
  LearningProvider: (props: LearningProviderProps) => {
    mocks.capture(props);
    return props.children;
  },
}));
vi.mock("../../context", async (importOriginal) => ({
  ...(await importOriginal<typeof ContextModule>()),
  useCopilotKit: mocks.context,
}));

function Thread({
  id,
  kind = "chat",
}: {
  id: string;
  kind?: "chat" | "agent";
}) {
  const { copilotkit } = useCopilotKit();
  const activate = useLearningThread(copilotkit.ɵlearningThreads, {
    kind,
    getThreadId: () => id,
  });
  return (
    <button onPointerDownCapture={activate} onFocusCapture={activate}>
      {id}
    </button>
  );
}
const interaction = (id: string): ProductInteractionEvent => ({
  id,
  actionId: id,
  timestamp: 1_700_000_000_000,
  type: "interaction",
  action: "click",
  target: { tagName: "button" },
});
const capture = () => mocks.capture.mock.lastCall![0];
const emit = async (event: ProductInteractionEvent) => {
  await act(async () => {
    capture().onEvent(event);
  });
};

describe("CopilotKitLearningProvider", () => {
  let notify: () => void;
  let core: {
    runtimeUrl: string;
    intelligence: object | undefined;
    headers: { Authorization: string };
    ɵruntimeFetch: ReturnType<typeof vi.fn<typeof fetch>>;
    subscribe: ReturnType<typeof vi.fn>;
    ɵlearningThreads: ReturnType<typeof createLearningThreadRegistry>;
  };
  const bodies = () =>
    core.ɵruntimeFetch.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
  beforeEach(() => {
    vi.clearAllMocks();
    core = {
      runtimeUrl: "/api/copilotkit",
      intelligence: {},
      ɵlearningThreads: createLearningThreadRegistry(),
      headers: { Authorization: "Bearer customer-auth" },
      ɵruntimeFetch: vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response('{"id":"stored","duplicate":false}'),
        ),
      subscribe: vi.fn((subscriber) => {
        notify = subscriber.onRuntimeConnectionStatusChanged;
        return { unsubscribe: vi.fn() };
      }),
    };
    mocks.context.mockReturnValue({ copilotkit: core });
  });
  afterEach(cleanup);

  it("waits for Intelligence discovery, supports opt-out, and excludes its transport", () => {
    core.intelligence = undefined;
    const { rerender } = render(<CopilotKitLearningProvider />);
    expect(capture().enabled).toBe(false);
    act(() => {
      core.intelligence = {};
      notify();
    });
    expect(capture().enabled).toBe(true);
    expect(capture().excludedUrlPrefixes).toEqual(["/api/copilotkit"]);
    rerender(<CopilotKitLearningProvider enabled={false} />);
    expect(capture().enabled).toBe(false);
  });

  it("automatically posts to the mounted thread without selecting a container", async () => {
    render(
      <StrictMode>
        <CopilotKitLearningProvider>
          <Thread id="thread-a" />
        </CopilotKitLearningProvider>
      </StrictMode>,
    );
    const event: ProductInteractionEvent = {
      ...interaction("event-1"),
      page: { pathname: "/expenses/review" },
    };
    await emit(event);
    expect(core.ɵruntimeFetch).toHaveBeenCalledTimes(1);
    expect(core.ɵruntimeFetch.mock.calls[0]?.[0]).toBe(
      "/api/copilotkit/annotate",
    );
    expect(bodies()[0]).toEqual({
      type: "user_action",
      threadId: "thread-a",
      clientEventId: event.id,
      occurredAt: "2023-11-14T22:13:20.000Z",
      payload: {
        title: "User click",
        data: { source: "copilotkit.learning", ...event },
      },
    });
  });

  it.each([
    "captureContext",
    "captureAccessibleNames",
    "captureTextValues",
    "captureRequestBodies",
  ] as const)(
    "does not restore old textual context after %s is disabled",
    async (option) => {
      const { rerender } = render(
        <CopilotKitLearningProvider>
          <Thread id="thread-a" />
        </CopilotKitLearningProvider>,
      );
      await emit({
        ...interaction("with-context"),
        type: "interaction",
        action: "click",
        target: { tagName: "button" },
        context: {
          items: [
            {
              kind: "heading",
              tagName: "h1",
              accessibleName: "Account review",
            },
          ],
        },
      });
      rerender(
        <CopilotKitLearningProvider {...{ [option]: false }}>
          <Thread id="thread-b" />
        </CopilotKitLearningProvider>,
      );
      await emit(interaction("without-context"));
      expect(bodies()).toHaveLength(2);
      expect(bodies()[0].payload.data.context).toBeDefined();
      expect(bodies()[1].threadId).toBe("thread-b");
      expect(bodies()[1].payload.data).not.toHaveProperty("context");
    },
  );

  it("discards queued page metadata when page capture is disabled", async () => {
    let finishRequest!: () => void;
    const pending = new Promise<Response>((resolve) => {
      finishRequest = () =>
        resolve(new Response('{"id":"stored","duplicate":false}'));
    });
    core.ɵruntimeFetch.mockImplementationOnce(() => pending);
    const { rerender } = render(
      <CopilotKitLearningProvider>
        <Thread id="thread-a" />
      </CopilotKitLearningProvider>,
    );
    await emit({
      ...interaction("in-flight"),
      page: { pathname: "/expenses" },
    });
    await emit({ ...interaction("queued"), page: { pathname: "/expenses" } });
    expect(core.ɵruntimeFetch).toHaveBeenCalledTimes(1);
    rerender(
      <CopilotKitLearningProvider capturePage={false}>
        <Thread id="thread-a" />
      </CopilotKitLearningProvider>,
    );
    expect(capture().capturePage).toBe(false);
    await emit(interaction("without-page"));
    await act(async () => finishRequest());
    expect(bodies().map((body) => body.clientEventId)).toEqual([
      "in-flight",
      "without-page",
    ]);
    expect(bodies()[1].payload.data).not.toHaveProperty("page");
  });

  it("does not invent a thread before mount or after the last chat unmounts", async () => {
    const { rerender } = render(<CopilotKitLearningProvider />);
    await emit(interaction("before"));
    rerender(
      <CopilotKitLearningProvider>
        <Thread id="thread-a" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("during"));
    rerender(<CopilotKitLearningProvider />);
    await emit(interaction("after"));
    expect(bodies().map((body) => body.clientEventId)).toEqual(["during"]);
  });

  it("follows A → B → A while retaining the original thread of an in-flight request", async () => {
    const { rerender } = render(
      <CopilotKitLearningProvider>
        <Thread id="thread-a" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("action-a"));
    rerender(
      <CopilotKitLearningProvider>
        <Thread id="thread-b" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("action-b"));
    await emit({
      id: "request-a",
      actionId: "action-a",
      timestamp: 1_700_000_000_050,
      type: "request",
      request: {
        method: "GET",
        url: "/api/expenses",
        durationMs: 50,
        status: 200,
        outcome: "success",
      },
    });
    rerender(
      <CopilotKitLearningProvider>
        <Thread id="thread-a" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("return-a"));
    expect(bodies().map((body) => [body.clientEventId, body.threadId])).toEqual(
      [
        ["action-a", "thread-a"],
        ["action-b", "thread-b"],
        ["request-a", "thread-a"],
        ["return-a", "thread-a"],
      ],
    );
  });

  it("requires selection among simultaneous chats and keeps background agents from stealing it", async () => {
    const { getByRole, rerender } = render(
      <CopilotKitLearningProvider>
        <Thread id="thread-a" />
        <Thread id="thread-b" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("ambiguous"));
    fireEvent.pointerDown(getByRole("button", { name: "thread-a" }));
    await emit(interaction("a"));
    rerender(
      <CopilotKitLearningProvider>
        <Thread id="thread-a" />
        <Thread id="thread-b" />
        <Thread id="background" kind="agent" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("still-a"));
    fireEvent.focus(getByRole("button", { name: "thread-b" }));
    await emit(interaction("b"));
    expect(bodies().map((body) => [body.clientEventId, body.threadId])).toEqual(
      [
        ["a", "thread-a"],
        ["still-a", "thread-a"],
        ["b", "thread-b"],
      ],
    );
  });

  it("supports a unique headless agent and does not guess between different headless threads", async () => {
    const { rerender } = render(
      <CopilotKitLearningProvider>
        <Thread id="headless-a" kind="agent" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("unique"));
    rerender(
      <CopilotKitLearningProvider>
        <Thread id="headless-a" kind="agent" />
        <Thread id="headless-b" kind="agent" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("ambiguous"));
    expect(bodies().map((body) => body.threadId)).toEqual(["headless-a"]);
  });

  it("stops delivery on opt-out and unmount, and reports transport failures", async () => {
    const onError = vi.fn();
    core.ɵruntimeFetch.mockRejectedValue(new Error("offline"));
    const { rerender, unmount } = render(
      <CopilotKitLearningProvider onError={onError}>
        <Thread id="thread-a" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("failure"));
    expect(onError).toHaveBeenCalledWith(new Error("offline"));
    rerender(
      <CopilotKitLearningProvider enabled={false}>
        <Thread id="thread-a" />
      </CopilotKitLearningProvider>,
    );
    await emit(interaction("disabled"));
    const onEvent = capture().onEvent;
    unmount();
    onEvent(interaction("unmounted"));
    expect(core.ɵruntimeFetch).toHaveBeenCalledTimes(1);
  });
});
