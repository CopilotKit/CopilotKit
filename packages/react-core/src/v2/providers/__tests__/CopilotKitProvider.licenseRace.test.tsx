import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

/**
 * Regression test for the cold-first-load race that stranded the threads drawer
 * on "Loading threads…".
 *
 * The core kicks off its `/info` fetch synchronously from its constructor
 * (during render). On a cold load (incognito / hard refresh) JS-compile
 * congestion can delay the provider's passive subscribe effect until AFTER
 * `/info` has already resolved and fired `onRuntimeConnectionStatusChanged`.
 * When that happens the event is missed, so the provider must instead READ the
 * already-settled values immediately. It previously read only `a2uiEnabled`,
 * leaving `licenseStatus` null forever → `licensePending` never clears →
 * <CopilotThreadsDrawer> is pinned to "Loading threads…".
 *
 * This test simulates "the connection event fired before we subscribed" by
 * giving the fake core a settled `licenseStatus` up front and a `subscribe`
 * that NEVER invokes the callback. The only way `status` can resolve is the
 * provider's immediate catch-up read.
 */

const { FAKE_LICENSE_STATUS } = vi.hoisted(() => ({
  FAKE_LICENSE_STATUS: "valid" as const,
}));

// A minimal fake core whose runtime info is already settled at construction
// time and whose `subscribe` never fires — mimicking a status change that
// happened before the provider got to subscribe. Defined inside the (hoisted)
// factory so it is available when the mocked module is first imported.
vi.mock("../../lib/react-core", () => {
  class FakeSettledCore {
    get a2uiEnabled() {
      return false;
    }
    get openGenerativeUIEnabled() {
      return false;
    }
    get licenseStatus() {
      return FAKE_LICENSE_STATUS;
    }
    get a2uiAgents() {
      return undefined;
    }
    // subscribe: return an inert subscription and NEVER call any handler.
    subscribe() {
      return { unsubscribe: () => {} };
    }
    // All configuration setters the provider drives in effects are no-ops here.
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
  return { CopilotKitCoreReact: FakeSettledCore };
});

import { CopilotKitProvider } from "../CopilotKitProvider";
import { useLicenseContext } from "../../context";

function LicenseProbe() {
  const { status } = useLicenseContext();
  return <div data-testid="license-probe">{`status:${status ?? "null"}`}</div>;
}

describe("CopilotKitProvider license status cold-load race", () => {
  it("captures a license status that settled before the subscribe effect ran", () => {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <LicenseProbe />
      </CopilotKitProvider>,
    );

    // No waitFor: the fake core never emits, so the value can ONLY come from the
    // provider's synchronous catch-up read. Before the fix this was
    // "status:null" (stuck-loading); after the fix it is the settled status.
    expect(screen.getByTestId("license-probe").textContent).toBe(
      `status:${FAKE_LICENSE_STATUS}`,
    );
  });
});
