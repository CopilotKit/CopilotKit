/**
 * Header functions are allowed to return a new object on every call.
 * The connect effect must not run again when the values stay the same,
 * and it must run again when a value changes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";

const headerCalls: Array<Record<string, string>> = [];

vi.mock("../../lib/react-core", () => {
  class FakeCore {
    constructor(_config: Record<string, unknown>) {}
    connect() {}
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
    setHeaders(headers: Record<string, string>) {
      headerCalls.push(headers);
    }
    setCredentials() {}
    setProperties() {}
    setMessageFilter() {}
    setTools() {}
    setRenderToolCalls() {}
    setRenderActivityMessages() {}
    setRenderCustomMessages() {}
    setAgents__unsafe_dev_only() {}
    setDebug() {}
    setLearningConfig() {}
    addContext() {}
    removeContext() {}
  }
  return { CopilotKitCoreReact: FakeCore };
});

import { CopilotKitProvider } from "../CopilotKitProvider";

const runtimeUrl = "https://runtime.example/rest";

describe("CopilotKitProvider headers", () => {
  beforeEach(() => {
    headerCalls.length = 0;
  });

  it("keeps equal header values stable and still applies a new token", async () => {
    let token = "a";
    const headers = () => ({ Authorization: token });

    const view = render(
      <CopilotKitProvider runtimeUrl={runtimeUrl} headers={headers}>
        <div>child</div>
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(headerCalls.length).toBeGreaterThan(0));
    const afterMount = headerCalls.length;
    expect(headerCalls[afterMount - 1]).toEqual({ Authorization: "a" });

    view.rerender(
      <CopilotKitProvider runtimeUrl={runtimeUrl} headers={headers}>
        <div>child</div>
      </CopilotKitProvider>,
    );

    expect(headerCalls.length).toBe(afterMount);

    token = "b";
    view.rerender(
      <CopilotKitProvider runtimeUrl={runtimeUrl} headers={headers}>
        <div>child</div>
      </CopilotKitProvider>,
    );

    await waitFor(() =>
      expect(headerCalls[headerCalls.length - 1]).toEqual({
        Authorization: "b",
      }),
    );
    expect(headerCalls.length).toBeGreaterThan(afterMount);
  });
});
