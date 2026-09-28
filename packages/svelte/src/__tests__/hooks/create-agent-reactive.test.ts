import { HttpAgent } from "@ag-ui/client";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import Harness from "./create-agent-reactive-harness.svelte";

const LIVE_URL = "https://live.test";
const STALE_URL = "https://stale.test";

type HttpAgentWithMarker = HttpAgent & { marker?: string };

function httpHeaders(agent: AbstractAgent): Record<string, string> {
  return (agent as unknown as { headers: Record<string, string> }).headers;
}

/**
 * The core mock carries STALE fields on purpose: getAgent("agent-b") returns
 * the wrong (DECOY) instance, and headers/runtimeUrl/status/transport differ
 * from the live reactive context values. The hook must follow the reactive
 * getters and use the core only for operations (lookup fallback,
 * subscriptions).
 */
function setup() {
  const agentA = new HttpAgent({
    url: LIVE_URL,
    agentId: "agent-a",
    headers: { "X-Agent": "preserved" },
  });
  const agentB = new HttpAgent({ url: LIVE_URL, agentId: "agent-b" });
  const decoyB = new HttpAgent({ url: STALE_URL, agentId: "agent-b" });
  (agentA as HttpAgentWithMarker).marker = "A";
  (agentB as HttpAgentWithMarker).marker = "B";
  (decoyB as HttpAgentWithMarker).marker = "DECOY";

  let providerHeaders: Record<string, string> = { "X-Test": "one" };
  const ownHeaders = new WeakMap<AbstractAgent, Record<string, string>>();
  const core = {
    agents: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    runtimeUrl: STALE_URL,
    runtimeTransport: "rest",
    headers: { "X-Stale": "stale" },
    getAgent: (id: string) =>
      id === "agent-a" ? agentA : id === "agent-b" ? decoyB : undefined,
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    setHeaders: vi.fn((headers: Record<string, string>) => {
      providerHeaders = { ...headers };
    }),
    applyHeadersToAgent: vi.fn((agent: AbstractAgent) => {
      if (!(agent instanceof HttpAgent)) return;
      let baseline = ownHeaders.get(agent);
      if (!baseline) {
        baseline = { ...agent.headers };
        ownHeaders.set(agent, baseline);
      }
      agent.headers = { ...baseline, ...providerHeaders };
    }),
  } as unknown as CopilotKitCoreSvelte;

  const view = render(Harness, {
    props: { core, initialAgents: { "agent-a": agentA, "agent-b": agentB } },
  });
  return { view, core, agentA, agentB, decoyB };
}

function subscribedAgent(core: CopilotKitCoreSvelte): AbstractAgent {
  const calls = (
    core.subscribeToAgentWithOptions as unknown as ReturnType<typeof vi.fn>
  ).mock.calls as Array<[AbstractAgent, unknown]>;
  const current = calls.at(-1)?.[0];
  if (!current) throw new Error("expected an agent subscription");
  return current;
}

describe("createAgent reactive provider context", () => {
  it("switches to the reactively registered agent instead of stale core fields", async () => {
    const { view, core, agentB } = setup();

    await waitFor(() => {
      expect(view.getByTestId("reactive-agent-identity").textContent).toBe("A");
    });

    await fireEvent.click(view.getByTestId("switch-agent"));

    // The stale core getAgent("agent-b") returns the DECOY instance; the
    // hook must resolve the reactive registry entry instead.
    await waitFor(() => {
      expect(view.getByTestId("reactive-agent-identity").textContent).toBe("B");
    });
    expect(view.getByTestId("reactive-agent-id").textContent).toBe("agent-b");
    // The core still performs the subscription operation, but against the
    // reactively resolved registry instance rather than the stale DECOY.
    expect(subscribedAgent(core)).toBe(agentB);

    view.unmount();
  });

  it("propagates provider header updates to HttpAgent instances and thread clones", async () => {
    const { view, core, agentA } = setup();

    await waitFor(() => {
      expect(view.getByTestId("reactive-agent-identity").textContent).toBe("A");
    });
    expect(httpHeaders(agentA)).toEqual({
      "X-Agent": "preserved",
      "X-Test": "one",
    });

    await fireEvent.click(view.getByTestId("rotate-headers"));
    await waitFor(() => {
      expect(httpHeaders(agentA)).toEqual({
        "X-Agent": "preserved",
        "X-Test": "two",
      });
    });

    await fireEvent.click(view.getByTestId("use-thread"));
    await waitFor(() => {
      expect(view.getByTestId("reactive-agent-identity").textContent).toBe(
        "clone",
      );
    });
    const clone = subscribedAgent(core);
    expect(clone).not.toBe(agentA);
    expect((clone as HttpAgent).threadId).toBe("thread-1");
    expect(httpHeaders(clone)).toEqual({
      "X-Agent": "preserved",
      "X-Test": "two",
    });

    // Existing thread clones must follow later provider header changes,
    // never the stale core headers.
    await fireEvent.click(view.getByTestId("rotate-headers"));
    await waitFor(() => {
      expect(httpHeaders(clone)).toEqual({
        "X-Agent": "preserved",
        "X-Test": "three",
      });
    });
    expect(httpHeaders(agentA)).toEqual({
      "X-Agent": "preserved",
      "X-Test": "three",
    });

    view.unmount();
  });

  it("builds provisional agents from reactive runtime config and follows header updates", async () => {
    const { view, core } = setup();

    await waitFor(() => {
      expect(view.getByTestId("reactive-agent-identity").textContent).toBe("A");
    });

    await fireEvent.click(view.getByTestId("go-ghost-offline"));

    await waitFor(() => {
      expect(view.getByTestId("reactive-agent-identity").textContent).toBe(
        "provisional",
      );
    });
    const provisional = subscribedAgent(core);
    expect(provisional.agentId).toBe("ghost");
    // Reactive runtimeUrl wins over the stale core runtimeUrl.
    const url = (provisional as unknown as { url: string }).url;
    expect(url).toContain("live.test");
    expect(url).not.toContain("stale");
    expect(httpHeaders(provisional)).toEqual({ "X-Test": "one" });

    await fireEvent.click(view.getByTestId("rotate-headers"));
    await waitFor(() => {
      expect(httpHeaders(provisional)).toEqual({ "X-Test": "two" });
    });

    view.unmount();
  });
});
