import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningProviderProps } from "@copilotkit/learning/react";
import type { ProductInteractionEvent } from "@copilotkit/learning";
import { CopilotKitLearningProvider } from "../CopilotKitLearningProvider";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  context: vi.fn(),
  chat: vi.fn(),
  subscription:
    vi.fn<(complete: (event: ProductInteractionEvent) => void) => void>(),
}));
vi.mock("@copilotkit/learning/react", () => ({
  LearningProvider: (props: LearningProviderProps) => {
    mocks.capture(props);
    const { onEvent } = props;
    useEffect(() => {
      let active = true;
      mocks.subscription((event) => {
        if (active) void onEvent(event);
      });
      return () => {
        active = false;
      };
    }, [onEvent]);
    return props.children;
  },
}));
vi.mock("../../context", () => ({ useCopilotKit: mocks.context }));
vi.mock("../CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: mocks.chat,
}));

const event: ProductInteractionEvent = {
  id: "client-event-1",
  actionId: "action-1",
  timestamp: 1_700_000_000_000,
  type: "interaction",
  action: "click",
  target: { tagName: "button" },
};
const capture = () => mocks.capture.mock.lastCall![0] as LearningProviderProps;

describe("CopilotKitLearningProvider", () => {
  let notify: () => void;
  let core: {
    runtimeUrl: string;
    intelligence: object | undefined;
    headers: Record<string, string>;
    ɵruntimeFetch: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.mockReturnValue(null);
    core = {
      runtimeUrl: "/api/copilotkit",
      intelligence: undefined,
      headers: { Authorization: "Bearer customer-auth" },
      ɵruntimeFetch: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "stored", duplicate: false })),
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
    const { rerender } = render(<CopilotKitLearningProvider />);
    expect(capture().enabled).toBe(false);
    act(() => {
      core.intelligence = { wsUrl: "wss://intelligence.test" };
      notify();
    });
    expect(capture().enabled).toBe(true);
    expect(capture().excludedUrlPrefixes).toEqual(["/api/copilotkit"]);
    rerender(<CopilotKitLearningProvider enabled={false} />);
    expect(capture().enabled).toBe(false);
  });

  it("posts captured actions through the actual manual annotation transport", async () => {
    core.intelligence = {};
    render(
      <CopilotKitLearningProvider
        threadId="thread-1"
        learningContainerId="expense-review"
      />,
    );
    await act(async () => {
      await capture().onEvent(event);
    });
    expect(core.ɵruntimeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = core.ɵruntimeFetch.mock.calls[0]!;
    expect(url).toBe("/api/copilotkit/annotate");
    expect(init.headers.Authorization).toBe("Bearer customer-auth");
    expect(JSON.parse(init.body)).toEqual({
      type: "user_action",
      threadId: "thread-1",
      clientEventId: event.id,
      learningContainerId: "expense-review",
      occurredAt: "2023-11-14T22:13:20.000Z",
      payload: {
        title: "User click",
        data: { source: "copilotkit.learning", ...event },
      },
    });
    expect(init.body).not.toContain("userId");
  });

  it("uses the current chat thread and survives StrictMode effect remounting", async () => {
    core.intelligence = {};
    mocks.chat.mockReturnValue({ threadId: "chat-thread" });
    render(
      <StrictMode>
        <CopilotKitLearningProvider />
      </StrictMode>,
    );
    await act(async () => {
      capture().onEvent(event);
    });
    expect(core.ɵruntimeFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(core.ɵruntimeFetch.mock.calls[0]![1].body).threadId).toBe(
      "chat-thread",
    );
  });

  it("uses a stable product-only session without requiring an agent run", async () => {
    core.intelligence = {};
    core.ɵruntimeFetch.mockImplementation(
      async () => new Response('{"id":"stored","duplicate":false}'),
    );
    const { rerender } = render(<CopilotKitLearningProvider />);
    await act(async () => {
      capture().onEvent(event);
    });
    rerender(<CopilotKitLearningProvider />);
    await act(async () => {
      capture().onEvent({ ...event, id: "event-2" });
    });
    const bodies = core.ɵruntimeFetch.mock.calls.map(([, init]) =>
      JSON.parse(init.body),
    );
    expect(bodies[0].threadId).toBeTruthy();
    expect(bodies[1].threadId).toBe(bodies[0].threadId);
  });

  it("stops queued delivery on unmount and routes failures to onError", async () => {
    core.intelligence = {};
    const onError = vi.fn();
    core.ɵruntimeFetch.mockRejectedValue(new Error("offline"));
    const { unmount } = render(
      <CopilotKitLearningProvider onError={onError} />,
    );
    await act(async () => {
      capture().onEvent(event);
    });
    expect(onError).toHaveBeenCalledWith(new Error("offline"));
    const onEvent = capture().onEvent;
    unmount();
    await onEvent(event);
    expect(core.ɵruntimeFetch).toHaveBeenCalledTimes(1);
  });

  it("retires pending captures when changing thread or container without remounting children", async () => {
    core.intelligence = {};
    function StatefulChild() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>{count}</button>;
    }
    const { rerender, getByRole } = render(
      <CopilotKitLearningProvider
        threadId="thread-a"
        learningContainerId="first"
      >
        <StatefulChild />
      </CopilotKitLearningProvider>,
    );
    const finishOldRequest = mocks.subscription.mock.lastCall![0];
    fireEvent.click(getByRole("button"));
    expect(getByRole("button").textContent).toBe("1");
    rerender(
      <CopilotKitLearningProvider
        threadId="thread-b"
        learningContainerId="second"
      >
        <StatefulChild />
      </CopilotKitLearningProvider>,
    );
    await act(async () => {
      finishOldRequest({
        ...event,
        type: "request",
        request: {
          method: "GET",
          url: "/api/orders",
          durationMs: 30,
          status: 200,
          outcome: "success",
        },
      });
    });
    expect(core.ɵruntimeFetch).not.toHaveBeenCalled();
    expect(getByRole("button").textContent).toBe("1");
    await act(async () => {
      mocks.subscription.mock.lastCall![0](event);
    });
    expect(JSON.parse(core.ɵruntimeFetch.mock.lastCall![1].body)).toMatchObject(
      { threadId: "thread-b", learningContainerId: "second" },
    );
  });
});
