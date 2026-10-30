/**
 * `CopilotKitHeadlessProvider` from `/v2/headless`: the core setup, tools,
 * context and license handling, with none of the `/v2` provider's built-ins
 * (#7882). `ɵextend` is how `CopilotKitProvider` adds them back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { z } from "zod";
import {
  CopilotKitHeadlessProvider,
  useAgent,
  useCopilotKit,
  useFrontendTool,
  useLicenseContext,
  useRenderToolCall,
} from "../../headless";
import type { CopilotKitCoreReact } from "../../headless";
import type { ReactActivityMessageRenderer } from "../../types";
import type { ReactFrontendTool } from "../../types/frontend-tool";
import type {
  ɵCopilotKitHeadlessProviderExtension,
  ɵCopilotKitRuntimeFeatures,
} from "../CopilotKitHeadlessProvider";

import {
  MockStepwiseAgent,
  runFinishedEvent,
  runStartedEvent,
  testId,
  textChunkEvent,
  toolCallChunkEvent,
} from "../../__tests__/utils/test-helpers";

const RUNTIME_URL = "https://runtime.example/api/copilotkit";

function stubRuntimeInfo(info: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.endsWith("/info")
      ? { version: "1.0.0", agents: {}, ...info }
      : {};
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

const userTool: ReactFrontendTool = {
  name: "userTool",
  parameters: z.object({}),
  handler: async () => "ok",
};

const userRenderer: ReactActivityMessageRenderer<any> = {
  activityType: "user-activity",
  content: z.any(),
  render: () => null,
};

describe("CopilotKitHeadlessProvider", () => {
  const originalFetch = global.fetch;
  let core: CopilotKitCoreReact | undefined;

  function CaptureCore() {
    core = useCopilotKit().copilotkit;
    return null;
  }

  beforeEach(() => {
    core = undefined;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("provides the core and registers prop tools, with no built-in renderers", () => {
    global.fetch = stubRuntimeInfo({}) as unknown as typeof fetch;
    render(
      <CopilotKitHeadlessProvider
        runtimeUrl={RUNTIME_URL}
        frontendTools={[userTool]}
      >
        <CaptureCore />
        <div data-testid="child" />
      </CopilotKitHeadlessProvider>,
    );

    expect(screen.getByTestId("child")).toBeTruthy();
    expect(core?.tools.map((t) => t.name)).toEqual(["userTool"]);
    // `/v2` always adds the MCP Apps renderer; the headless provider adds none.
    expect(core?.renderActivityMessages).toEqual([]);
  });

  it("exposes the license status without rendering a banner", async () => {
    global.fetch = stubRuntimeInfo({
      licenseStatus: "none",
    }) as unknown as typeof fetch;
    let status: string | null | undefined;
    function ReadLicense() {
      status = useLicenseContext().status;
      return null;
    }

    const { container } = render(
      <CopilotKitHeadlessProvider runtimeUrl={RUNTIME_URL}>
        <ReadLicense />
      </CopilotKitHeadlessProvider>,
    );

    await waitFor(() => expect(status).toBe("none"));
    expect(screen.queryByText(/Powered by CopilotKit/)).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  describe("ɵextend", () => {
    const extensionTool: ReactFrontendTool = {
      name: "extensionTool",
      parameters: z.object({}),
      handler: async () => "ok",
    };
    const extensionRenderer: ReactActivityMessageRenderer<any> = {
      activityType: "extension-activity",
      content: z.any(),
      render: () => null,
    };

    function renderExtended(
      info: Record<string, unknown>,
      extend: (
        core: CopilotKitCoreReact | null,
        runtime: ɵCopilotKitRuntimeFeatures,
      ) => ɵCopilotKitHeadlessProviderExtension,
    ) {
      global.fetch = stubRuntimeInfo(info) as unknown as typeof fetch;
      return render(
        <CopilotKitHeadlessProvider
          runtimeUrl={RUNTIME_URL}
          useSingleEndpoint={false}
          frontendTools={[userTool]}
          humanInTheLoop={[
            { name: "userHitl", parameters: z.object({}), render: () => null },
          ]}
          renderActivityMessages={[userRenderer]}
          properties={{ user: 1, shared: "user" }}
          ɵextend={extend}
        >
          <CaptureCore />
          <div data-testid="child" />
        </CopilotKitHeadlessProvider>,
      );
    }

    it("passes its results to the core constructor, after the caller's entries", () => {
      renderExtended({}, () => ({
        tools: [extensionTool],
        renderActivityMessages: [extensionRenderer],
        properties: { shared: "extension" },
        children: <div data-testid="extension-child" />,
      }));

      // Registered before any effect runs, so child hooks are not overwritten.
      expect(core?.tools.map((t) => t.name)).toEqual([
        "userTool",
        "extensionTool",
        "userHitl",
      ]);
      expect(core?.renderActivityMessages.map((r) => r.activityType)).toEqual([
        "user-activity",
        "extension-activity",
      ]);
      expect(screen.getByTestId("extension-child")).toBeTruthy();
      expect(screen.getByTestId("child")).toBeTruthy();
    });

    it("merges its properties over the caller's", async () => {
      renderExtended({}, () => ({ properties: { shared: "extension" } }));

      await waitFor(() =>
        expect(core?.properties).toEqual({ user: 1, shared: "extension" }),
      );
    });

    it("is called again with the runtime flags from /info", async () => {
      const extend = vi.fn(
        (
          _core: CopilotKitCoreReact | null,
          runtime: ɵCopilotKitRuntimeFeatures,
        ) => ({
          tools: runtime.openGenerativeUIEnabled ? [extensionTool] : undefined,
        }),
      );
      renderExtended(
        { a2uiEnabled: true, openGenerativeUIEnabled: true },
        extend,
      );

      expect(extend).toHaveBeenNthCalledWith(1, null, {
        a2uiEnabled: false,
        openGenerativeUIEnabled: false,
      });
      await waitFor(() =>
        expect(extend).toHaveBeenLastCalledWith(core, {
          a2uiEnabled: true,
          openGenerativeUIEnabled: true,
        }),
      );
      await waitFor(() =>
        expect(core?.tools.map((t) => t.name)).toEqual([
          "userTool",
          "extensionTool",
          "userHitl",
        ]),
      );
    });
  });

  it("runs an agent with a frontend tool from a custom UI built on the headless entry", async () => {
    const agent = new MockStepwiseAgent();
    const handler = vi.fn(
      async ({ city }: { city: string }) => `sunny in ${city}`,
    );

    function CustomChat() {
      const { agent: chatAgent } = useAgent();
      const { copilotkit } = useCopilotKit();
      const renderToolCall = useRenderToolCall();
      useFrontendTool({
        name: "getWeather",
        parameters: z.object({ city: z.string() }),
        handler,
        render: ({ status, result }) => (
          <div data-testid="weather">
            {status}:{result ?? ""}
          </div>
        ),
      });

      return (
        <div>
          <button
            onClick={() => {
              chatAgent.addMessage({
                id: testId("u"),
                role: "user",
                content: "weather?",
              });
              void copilotkit.runAgent({ agent: chatAgent });
            }}
          >
            send
          </button>
          {chatAgent.messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id}>{String(m.content)}</p>
            ) : m.role === "assistant" ? (
              <div key={m.id}>
                {m.content ? <p>{m.content}</p> : null}
                {m.toolCalls?.map((tc) => (
                  <div key={tc.id}>
                    {renderToolCall({
                      toolCall: tc,
                      toolMessage: chatAgent.messages.find(
                        (t) => t.role === "tool" && t.toolCallId === tc.id,
                      ) as any,
                    })}
                  </div>
                ))}
              </div>
            ) : null,
          )}
        </div>
      );
    }

    render(
      <CopilotKitHeadlessProvider agents__unsafe_dev_only={{ default: agent }}>
        <CustomChat />
      </CopilotKitHeadlessProvider>,
    );

    fireEvent.click(screen.getByText("send"));
    // The run has subscribed to the agent once the user message is rendered.
    await screen.findByText("weather?");
    const messageId = testId("msg");
    agent.emit(runStartedEvent());
    agent.emit(textChunkEvent(messageId, "Checking."));
    agent.emit(
      toolCallChunkEvent({
        toolCallId: testId("tc"),
        toolCallName: "getWeather",
        parentMessageId: messageId,
        delta: JSON.stringify({ city: "Paris" }),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(() => expect(handler).toHaveBeenCalled());
    expect(handler.mock.calls[0]![0]).toEqual({ city: "Paris" });
    expect(await screen.findByText("Checking.")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("weather").textContent).toBe(
        "complete:sunny in Paris",
      ),
    );
  });
});
