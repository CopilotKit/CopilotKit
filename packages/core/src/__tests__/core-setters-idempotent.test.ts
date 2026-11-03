import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

/**
 * Providers call every setter on each render with fresh values. A setter that
 * gets the value it already holds must not notify subscribers or refetch.
 */

class IdleAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}

const runtimeUrl = "https://runtime.example/api/copilotkit";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A connected core whose runtime advertises inspector metadata. Returns the
 * credentials mode of every inspector-metadata request it sends.
 */
async function connectedCoreWithInspectorMetadata() {
  const metadataCredentials: Array<RequestCredentials | undefined> = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          mode: "sse",
          inspectorMetadata: true,
        });
      }
      metadataCredentials.push(init?.credentials);
      return jsonResponse({
        schemaVersion: 1,
        plan: { code: "pro", label: "Pro" },
      });
    }),
  );
  const core = new CopilotKitCore({
    runtimeUrl,
    runtimeTransport: "rest",
    credentials: "same-origin",
  });
  await waitForCondition(() => core.inspectorMetadata !== undefined);
  return { core, metadataCredentials };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("setCredentials", () => {
  it("does not refetch inspector metadata for the current credentials", async () => {
    const { core, metadataCredentials } =
      await connectedCoreWithInspectorMetadata();
    const metadataBefore = core.inspectorMetadata;

    core.setCredentials("same-origin");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(metadataCredentials).toEqual(["same-origin"]);
    expect(core.inspectorMetadata).toBe(metadataBefore);
    core.dispose();
  });

  it("refetches inspector metadata with new credentials", async () => {
    const { core, metadataCredentials } =
      await connectedCoreWithInspectorMetadata();

    core.setCredentials("include");
    await waitForCondition(() => metadataCredentials.length === 2);

    expect(metadataCredentials).toEqual(["same-origin", "include"]);
    expect(core.credentials).toBe("include");
    core.dispose();
  });
});

describe("setProperties", () => {
  it("does not notify for an object with the same keys and values", async () => {
    const core = new CopilotKitCore({ properties: { tier: "gold", seats: 3 } });
    const onPropertiesChanged = vi.fn();
    core.subscribe({ onPropertiesChanged });

    core.setProperties({ seats: 3, tier: "gold" });
    await Promise.resolve();

    expect(onPropertiesChanged).not.toHaveBeenCalled();
    expect(core.properties).toEqual({ tier: "gold", seats: 3 });
  });

  it("notifies when a value changes", async () => {
    const core = new CopilotKitCore({ properties: { tier: "gold" } });
    const onPropertiesChanged = vi.fn();
    core.subscribe({ onPropertiesChanged });

    core.setProperties({ tier: "silver" });
    await Promise.resolve();

    expect(onPropertiesChanged).toHaveBeenCalledTimes(1);
    expect(onPropertiesChanged.mock.calls[0]?.[0].properties).toEqual({
      tier: "silver",
    });
  });
});

describe("setAgents__unsafe_dev_only", () => {
  it("announces constructor agents once, then ignores the same agents", async () => {
    const agent = new IdleAgent();
    const agents = { assistant: agent };
    const core = new CopilotKitCore({ agents__unsafe_dev_only: agents });
    const onAgentsChanged = vi.fn();
    core.subscribe({ onAgentsChanged });

    // Constructor agents are not announced, so the provider's first sync must
    // still announce them.
    core.setAgents__unsafe_dev_only(agents);
    core.setAgents__unsafe_dev_only({ assistant: agent });
    await Promise.resolve();

    expect(onAgentsChanged).toHaveBeenCalledTimes(1);
  });

  it("announces a different agent under the same id", async () => {
    const agents = { assistant: new IdleAgent() };
    const core = new CopilotKitCore({ agents__unsafe_dev_only: agents });
    core.setAgents__unsafe_dev_only(agents);
    const onAgentsChanged = vi.fn();
    core.subscribe({ onAgentsChanged });
    const replacement = new IdleAgent();

    core.setAgents__unsafe_dev_only({ assistant: replacement });
    await Promise.resolve();

    expect(onAgentsChanged).toHaveBeenCalledTimes(1);
    expect(core.getAgent("assistant")).toBe(replacement);
  });
});
