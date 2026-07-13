/**
 * #5801 deferral wiring: the provider must construct the core WITHOUT starting
 * the `/info` connection during render (`deferInitialConnection: true`) and
 * start the single connection from a commit-phase effect via `connect()`.
 *
 * This is the provider-level assertion that actually distinguishes the fix from
 * the bug: it fails if the provider drops `deferInitialConnection` (reverting to
 * a constructor-fired `/info`) or stops calling `connect()`. It mocks the core
 * to capture how the provider constructs and drives it — a normal render can't
 * observe the multi-instance duplication (see the note in
 * `CopilotKitProvider.deferConnection.test.tsx`).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";

const ctorConfigs: Array<Record<string, unknown>> = [];
const connectCalls: string[] = [];

vi.mock("../../lib/react-core", () => {
  class FakeCore {
    constructor(config: Record<string, unknown>) {
      ctorConfigs.push(config);
    }
    connect() {
      connectCalls.push("connect");
    }
    subscribe() {
      return { unsubscribe: () => {} };
    }
    get a2uiEnabled() {
      return false;
    }
    get openGenerativeUIEnabled() {
      return false;
    }
    get licenseStatus() {
      return undefined;
    }
    get a2uiAgents() {
      return undefined;
    }
    setDefaultThrottleMs() {}
    setRuntimeUrl() {}
    setRuntimeTransport() {}
    setHeaders() {}
    setCredentials() {}
    setProperties() {}
    setTools() {}
    setRenderToolCalls() {}
    setRenderActivityMessages() {}
    setRenderCustomMessages() {}
    setAgents__unsafe_dev_only() {}
    setDebug() {}
    addContext() {}
    removeContext() {}
  }
  return { CopilotKitCoreReact: FakeCore };
});

import { CopilotKitProvider } from "../CopilotKitProvider";

describe("CopilotKitProvider — deferral wiring (mocked core, #5801)", () => {
  beforeEach(() => {
    ctorConfigs.length = 0;
    connectCalls.length = 0;
  });

  it("constructs the core with deferInitialConnection and connects from an effect", async () => {
    render(
      <CopilotKitProvider runtimeUrl="https://runtime.example/rest">
        <div>child</div>
      </CopilotKitProvider>,
    );

    // The core was told NOT to connect from its constructor...
    expect(ctorConfigs.length).toBeGreaterThanOrEqual(1);
    expect(ctorConfigs[0]?.deferInitialConnection).toBe(true);
    // ...and the provider started the connection from a commit-phase effect.
    await waitFor(() => expect(connectCalls.length).toBeGreaterThanOrEqual(1));
  });
});
