import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, shallowRef } from "vue";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  envelopeToManifest,
  GENERATIVE_UI_ACTIVITY_TYPE,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import { STANDARD_CATALOG_ID } from "@copilotkit/shared/generative-ui";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import type { CopilotKitProviderProps } from "../../providers/CopilotKitProvider.types";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import { useCopilotKit } from "../../providers/useCopilotKit";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import {
  runFinishedEvent,
  runStartedEvent,
} from "../../__tests__/utils/test-helpers";
import { CapturingAgent } from "./helpers/capturing-agent";
import { createGenerativeUI } from "../catalog";
import { useGenerativeUIRuntime } from "../runtime-context";
import { standardUI } from "../standard";

// The provider falls back to `standardUI` when it has no `generativeUI` UI
// and the runtime `/info` turns generative UI on. The standard UI loads with
// a dynamic import, so these tests wait for it.

const T = "thread-1";
/**
 * The first load of the standard UI transforms all of its components, which
 * is slow when the whole suite runs at once.
 */
const LOAD_WAIT = { timeout: 15_000 };

/** Answers `/info` with `generativeUI`, and fails every other request. */
function stubRuntimeInfo(generativeUI?: {
  enabled: boolean;
  agents?: string[];
}) {
  const fetchMock = vi.fn(async (url: unknown) => {
    if (!String(url).includes("/info")) throw new Error("unexpected request");
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "1.0.0",
        agents: {},
        audioFileTranscriptionEnabled: false,
        ...(generativeUI ? { generativeUI } : {}),
      }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

function setup({
  generativeUI,
  a2ui,
}: Pick<CopilotKitProviderProps, "generativeUI" | "a2ui"> = {}) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const core = shallowRef<CopilotKitCoreVue>();
  const runtime = shallowRef<ReturnType<typeof useGenerativeUIRuntime>>();
  const Probe = defineComponent({
    setup() {
      core.value = useCopilotKit().copilotkit.value;
      runtime.value = useGenerativeUIRuntime();
      return () => null;
    },
  });
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
      Probe,
    },
    setup: () => ({ agent, T, generativeUI, a2ui }),
    template: `
      <CopilotKitProvider
        runtime-url="/api/copilotkit"
        :agents__unsafe_dev_only="{ default: agent }"
        :generativeUI="generativeUI"
        :a2ui="a2ui"
      >
        <Probe />
        <CopilotChatConfigurationProvider agent-id="default" :thread-id="T">
          <div style="height: 400px">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  render(Host);
  /** Resolves once `/info` is in. */
  const connected = () =>
    waitFor(() =>
      expect(core.value?.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      ),
    );
  /** Whether the provider renders generative UI surfaces. */
  const rendersSurfaces = () =>
    !!core.value?.renderActivityMessages.some(
      (renderer) => renderer.activityType === GENERATIVE_UI_ACTIVITY_TYPE,
    );
  /** The generative UI runtime that the provider gives its children. */
  const generativeUIRuntime = () => runtime.value?.value;
  return { agent, connected, rendersSurfaces, generativeUIRuntime };
}

/** Sends `text` from the chat input, and waits until the run has started. */
async function send(text: string) {
  const runs = CapturingAgent.inputs.length;
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, text);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(runs + 1));
}

/** A chat surface of the standard catalog with one `Text`. */
const standardSurface = (surfaceId: string, text: string): BaseEvent => ({
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
  },
  replace: true,
});

const manifestOf = (input: RunAgentInput | undefined) => {
  const envelope = readCopilotKitUIEnvelope(input?.forwardedProps);
  return envelope && envelopeToManifest(envelope);
};

const chatSurface = (surfaceId: string) =>
  document.querySelector(`[data-generative-ui-chat-surface="${surfaceId}"]`);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("generative UI default from the runtime", { timeout: 30_000 }, () => {
  it("renders surfaces with the standard UI when the runtime turns generative UI on and the provider has no UI", async () => {
    stubRuntimeInfo({ enabled: true });
    const { agent, rendersSurfaces } = setup();
    // The standard UI loads once `/info` turns generative UI on.
    await waitFor(() => expect(rendersSurfaces()).toBe(true), LOAD_WAIT);

    await send("show it");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(standardSurface("s1", "Hello from the standard UI"));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

    // The run advertised the standard catalog to every agent.
    expect(manifestOf(CapturingAgent.inputs[0])?.catalogId).toBe(
      STANDARD_CATALOG_ID,
    );

    await waitFor(() =>
      expect(chatSurface("s1")?.textContent).toContain(
        "Hello from the standard UI",
      ),
    );
  });

  it("renders nothing and sends no envelope when the runtime does not turn generative UI on", async () => {
    stubRuntimeInfo();
    const { agent, connected, rendersSurfaces } = setup();
    await connected();
    expect(rendersSurfaces()).toBe(false);

    await send("show it");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(standardSurface("s1", "Hello from the standard UI"));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => expect(agent.isRunning).toBe(false));
    // Let the activity message reach the chat.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(manifestOf(CapturingAgent.inputs[0])).toBeUndefined();
    expect(chatSurface("s1")).toBeNull();
    expect(screen.queryByText("Hello from the standard UI")).toBeNull();
  });

  it("scopes the standard UI to the agents of the runtime", async () => {
    stubRuntimeInfo({ enabled: true, agents: ["other"] });
    const { agent, rendersSurfaces } = setup();
    await waitFor(() => expect(rendersSurfaces()).toBe(true), LOAD_WAIT);

    await send("hi");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

    expect(manifestOf(CapturingAgent.inputs[0])).toBeUndefined();
  });
});

describe("the deprecated a2ui prop", { timeout: 30_000 }, () => {
  const appUI = createGenerativeUI({
    id: "app",
    components: { Box: { component: () => null } },
  });
  const theme = { "--a2ui-color-panel": "#101010" };

  it("renders with a2ui.catalog as the ui of generativeUI, also when the runtime has generative UI off", async () => {
    stubRuntimeInfo();
    const { generativeUIRuntime } = setup({ a2ui: { catalog: appUI } });
    await waitFor(() => expect(generativeUIRuntime()?.ui).toBe(appUI));

    await send("show it");
    expect(manifestOf(CapturingAgent.inputs[0])?.catalogId).toBe("app");
  });

  it("gives a2ui.theme to the standard UI of the runtime", async () => {
    stubRuntimeInfo({ enabled: true });
    const { generativeUIRuntime } = setup({ a2ui: { theme } });

    await waitFor(
      () => expect(generativeUIRuntime()?.ui).toBe(standardUI),
      LOAD_WAIT,
    );
    expect(generativeUIRuntime()?.theme).toEqual(theme);
  });

  it("keeps the options of generativeUI over a2ui and adds the ones it leaves out", async () => {
    stubRuntimeInfo();
    const otherUI = createGenerativeUI({
      id: "other",
      components: { Box: { component: () => null } },
    });
    const { generativeUIRuntime } = setup({
      generativeUI: { ui: appUI },
      a2ui: { catalog: otherUI, theme },
    });

    await waitFor(() => expect(generativeUIRuntime()?.ui).toBe(appUI));
    expect(generativeUIRuntime()?.theme).toEqual(theme);
  });
});
