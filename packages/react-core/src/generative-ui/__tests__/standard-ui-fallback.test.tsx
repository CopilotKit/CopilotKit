import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  envelopeToManifest,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import { STANDARD_CATALOG_ID } from "@copilotkit/shared/generative-ui";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  runFinishedEvent,
  runStartedEvent,
} from "../../__tests__/utils/test-helpers";
import { stubWindowLocation } from "../../test-helpers/stub-window-location";
import { useGenerativeUIRuntime } from "../runtime-context";
import type {
  GenerativeUIConfig,
  GenerativeUIRuntime,
} from "../runtime-context";
import { createGenerativeUI } from "../catalog";
import { standardUI } from "../standard";

// With no `generativeUI` prop, the provider renders generative UI with the
// standard UI when the runtime reports it on in `/info`. The runtime converts
// the output of a v0.9 agent to 1.0, so a converted surface arrives as a
// `generative-ui-surface` activity on the standard catalog.

class CapturingAgent extends MockStepwiseAgent {
  static inputs: RunAgentInput[] = [];
  run(input: RunAgentInput) {
    CapturingAgent.inputs.push(input);
    return super.run(input);
  }
}

const T = "thread-1";

/** A surface the runtime converted from v0.9: standard catalog, 1.0 operations. */
const convertedSurface = (surfaceId: string, text: string): BaseEvent =>
  ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: `genui:${surfaceId}`,
    activityType: GENERATIVE_UI_ACTIVITY_TYPE,
    content: {
      surfaceId,
      target: "chat",
      catalogId: STANDARD_CATALOG_ID,
      operations: [
        {
          version: "1.0",
          createSurface: { surfaceId, catalogId: STANDARD_CATALOG_ID },
        },
        {
          version: "1.0",
          updateComponents: {
            surfaceId,
            components: [{ id: "root", component: "Text", text }],
          },
        },
      ],
      status: "ready",
      rejected: [],
      a2uiSourceVersion: "0.9",
    },
    replace: true,
  }) as BaseEvent;

function mockInfo(generativeUI: { enabled: boolean; agents?: string[] }) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      version: "1.0.0",
      agents: {},
      audioFileTranscriptionEnabled: false,
      generativeUI,
    }),
  });
}

function setup(generativeUI?: GenerativeUIConfig) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const captured: { runtime?: GenerativeUIRuntime | null } = {};
  function Probe() {
    captured.runtime = useGenerativeUIRuntime();
    return null;
  }
  render(
    <CopilotKitProvider
      runtimeUrl="http://localhost:3000/api"
      agents__unsafe_dev_only={{ default: agent }}
      generativeUI={generativeUI}
    >
      <Probe />
      <CopilotChatConfigurationProvider agentId="default" threadId={T}>
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
  return { agent, captured };
}

async function send(text: string) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(CapturingAgent.inputs.length).toBeGreaterThan(0));
}

function manifestOf(input: RunAgentInput | undefined) {
  const envelope = readCopilotKitUIEnvelope(input?.forwardedProps);
  return envelope && envelopeToManifest(envelope);
}

describe("CopilotKitProvider: the standard UI for the runtime's generative UI", () => {
  const originalFetch = global.fetch;
  let restoreLocation: () => void = () => {};

  beforeEach(() => {
    restoreLocation = stubWindowLocation();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreLocation();
  });

  it("renders a converted surface with the standard catalog when the runtime turns generative UI on", async () => {
    mockInfo({ enabled: true });
    const { agent, captured } = setup();

    // The standard UI loads on demand once `/info` turns it on.
    await waitFor(() => expect(captured.runtime?.ui).toBe(standardUI));

    await send("show me");
    // The run tells the agent about the standard catalog.
    expect(manifestOf(CapturingAgent.inputs[0])?.catalogId).toBe(
      STANDARD_CATALOG_ID,
    );
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(convertedSurface("converted", "Hello from v0.9"));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

    expect(await screen.findByText("Hello from v0.9")).toBeTruthy();
  });

  it("does nothing when the runtime has generative UI off", async () => {
    mockInfo({ enabled: false });
    const { agent, captured } = setup();

    await send("show me");
    expect(captured.runtime).toBeNull();
    expect(
      readCopilotKitUIEnvelope(CapturingAgent.inputs[0]?.forwardedProps),
    ).toBeUndefined();
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(convertedSurface("converted", "Hello from v0.9"));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

    await waitFor(() => expect(screen.getByText("show me")).toBeTruthy());
    expect(screen.queryByText("Hello from v0.9")).toBeNull();
    expect(captured.runtime).toBeNull();
  });

  it("keeps the app's generativeUI over the standard UI", async () => {
    mockInfo({ enabled: true });
    const ui = createGenerativeUI({
      id: "app",
      components: { Box: { component: () => null } },
    });
    const { captured } = setup({ ui });

    await waitFor(() => expect(captured.runtime?.ui).toBe(ui));
    await send("show me");
    expect(manifestOf(CapturingAgent.inputs[0])?.catalogId).toBe("app");
    expect(captured.runtime?.ui).toBe(ui);
  });

  it("keeps the other options of a generativeUI without ui, such as the map loader", async () => {
    mockInfo({ enabled: true, agents: ["other"] });
    const map = vi.fn(async () => ({}));
    const { captured } = setup({ map, agentIds: ["default"] });

    await waitFor(() => expect(captured.runtime?.ui).toBe(standardUI));
    expect(captured.runtime?.config.map).toBe(map);
    // The app's agents win over the runtime's.
    expect(captured.runtime?.config.agentIds).toEqual(["default"]);
  });

  it("does nothing for a generativeUI without ui when the runtime has generative UI off", async () => {
    mockInfo({ enabled: false });
    const { captured } = setup({ map: vi.fn(async () => ({})) });

    await send("show me");
    expect(captured.runtime).toBeNull();
  });

  it("gives the standard UI only to the agents the runtime names", async () => {
    mockInfo({ enabled: true, agents: ["other"] });
    const { captured } = setup();

    await waitFor(() => expect(captured.runtime?.ui).toBe(standardUI));
    expect(captured.runtime?.config.agentIds).toEqual(["other"]);
    await send("show me");
    // The chat's agent is not one of them, so its run gets no envelope.
    expect(
      readCopilotKitUIEnvelope(CapturingAgent.inputs[0]?.forwardedProps),
    ).toBeUndefined();
  });
});
