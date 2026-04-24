import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotKitCoreErrorCode } from "@copilotkit/core";
import { stubWindowLocation } from "../../../test-helpers/stub-window-location";

describe("CopilotKitProvider onError", () => {
  const originalFetch = global.fetch;
  let restoreLocation: () => void = () => {};

  beforeEach(() => {
    restoreLocation = stubWindowLocation();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    restoreLocation();
  });

  it("onError fires when runtime info fetch fails (no publicApiKey required)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    const onError = vi.fn();

    render(
      <CopilotKitProvider
        runtimeUrl="http://localhost:59999/nonexistent"
        onError={onError}
      >
        <div>child</div>
      </CopilotKitProvider>,
    );

    // Wait for the async /info fetch to fail and onError to fire
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    const event = onError.mock.calls[0][0];
    expect(event.code).toBe(CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED);
    expect(event.error).toBeInstanceOf(Error);
    expect(event.error.message).toContain("network failure");
  });

  it("onError fires without publicApiKey", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    const onError = vi.fn();

    // No publicApiKey — onError should still fire (unlike v1)
    render(
      <CopilotKitProvider
        runtimeUrl="http://localhost:59999/nonexistent"
        onError={onError}
      >
        <div>child</div>
      </CopilotKitProvider>,
    );

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });
});
