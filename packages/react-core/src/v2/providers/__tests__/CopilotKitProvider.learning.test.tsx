import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningProviderProps } from "@copilotkit/learning/react";
import { CopilotKit } from "../../../v1-deprecated/components/copilot-provider/copilotkit";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import type { CopilotKitProviderProps } from "../CopilotKitProvider";
import { useLearningThread } from "../../hooks/use-learning-thread";

const capture = vi.hoisted(() =>
  vi.fn<(props: LearningProviderProps) => void>(),
);
vi.mock("@copilotkit/learning/react", () => ({
  LearningProvider: (props: LearningProviderProps) => {
    capture(props);
    return props.children;
  },
}));

function Thread() {
  const { copilotkit } = useCopilotKit();
  useLearningThread(copilotkit.ɵlearningThreads, {
    kind: "chat",
    getThreadId: () => "current-thread",
  });
  return <output>{copilotkit.intelligence ? "connected" : "waiting"}</output>;
}

describe.each([
  ["current", CopilotKitProvider],
  ["compatibility", CopilotKit],
] as const)("%s provider learning opt-in", (_, Provider) => {
  const runtimeFetch = vi.fn<typeof fetch>();
  let intelligenceAvailable: boolean;

  beforeEach(() => {
    capture.mockClear();
    runtimeFetch.mockReset();
    intelligenceAvailable = true;
    runtimeFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/annotate")) {
        return new Response(JSON.stringify({ id: "stored", duplicate: false }));
      }
      return new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: { default: { name: "default", description: "Test agent" } },
          ...(intelligenceAvailable && {
            intelligence: { wsUrl: "ws://localhost/client" },
          }),
        }),
      );
    });
    vi.stubGlobal("fetch", runtimeFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  function app(learning?: CopilotKitProviderProps["learning"]) {
    return (
      <Provider
        runtimeUrl="http://localhost/api/copilotkit"
        enableInspector={false}
        showDevConsole={false}
        learning={learning}
      >
        <Thread />
      </Provider>
    );
  }

  const annotations = () =>
    runtimeFetch.mock.calls
      .filter(([url]) => String(url).endsWith("/annotate"))
      .map(([, init]) => JSON.parse(String(init?.body)));

  it.each([undefined, false] as const)(
    "does not mount capture with learning=%s, even after Intelligence connects",
    async (learning) => {
      const view = render(app(learning));
      await waitFor(() => expect(view.getByText("connected")).toBeDefined());
      expect(capture).not.toHaveBeenCalled();
      expect(annotations()).toEqual([]);
    },
  );

  it.each([true, { apiUrlPrefixes: ["/api/expenses"] }])(
    "explicitly enables capture and delivers to the current thread: %j",
    async (learning) => {
      render(app(learning));
      await waitFor(() =>
        expect(capture.mock.lastCall?.[0].enabled).toBe(true),
      );
      const event = {
        id: "opted-in-click",
        actionId: "opted-in-click",
        timestamp: 1_700_000_000_000,
        type: "interaction" as const,
        action: "click" as const,
        target: { tagName: "button" },
      };
      await act(async () => capture.mock.lastCall![0].onEvent(event));
      expect(annotations()).toEqual([
        expect.objectContaining({
          type: "user_action",
          threadId: "current-thread",
          payload: {
            title: "User click",
            data: { source: "copilotkit.learning", ...event },
          },
        }),
      ]);
      expect(annotations()[0]).not.toHaveProperty("learningContainerId");
      if (typeof learning === "object") {
        expect(capture.mock.lastCall![0].apiUrlPrefixes).toEqual([
          "/api/expenses",
        ]);
      }
    },
  );

  it("stops delivery when opt-in is removed and resumes when re-enabled", async () => {
    const view = render(app(true));
    await waitFor(() => expect(capture.mock.lastCall?.[0].enabled).toBe(true));
    const priorCapture = capture.mock.lastCall![0];
    view.rerender(app());
    const event = {
      id: "disabled-click",
      actionId: "disabled-click",
      timestamp: 1_700_000_000_000,
      type: "interaction" as const,
      action: "click" as const,
      target: { tagName: "button" },
    };
    await act(async () => priorCapture.onEvent(event));
    expect(annotations()).toEqual([]);
    view.rerender(app(true));
    await waitFor(() => expect(capture.mock.lastCall?.[0].enabled).toBe(true));
    await act(async () => capture.mock.lastCall![0].onEvent(event));
    expect(annotations()).toHaveLength(1);
  });

  it("keeps an explicitly disabled configuration inactive", async () => {
    const view = render(app({ enabled: false }));
    await waitFor(() => expect(view.getByText("connected")).toBeDefined());
    expect(capture.mock.lastCall?.[0].enabled).toBe(false);
    expect(annotations()).toEqual([]);
  });

  it("does not let enabled=true bypass Intelligence discovery", async () => {
    intelligenceAvailable = false;
    render(app({ enabled: true }));
    await waitFor(() => expect(runtimeFetch).toHaveBeenCalled());
    await act(async () => {});
    expect(capture.mock.lastCall?.[0].enabled).toBe(false);
    expect(annotations()).toEqual([]);
  });
});
