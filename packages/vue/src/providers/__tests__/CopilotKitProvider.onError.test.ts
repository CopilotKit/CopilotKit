import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/vue";
import { CopilotKitCoreErrorCode } from "@copilotkit/core";
import CopilotKitProvider from "../CopilotKitProvider.vue";

describe("CopilotKitProvider onError", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("onError fires when runtime info fetch fails (no publicApiKey required)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
    const onError = vi.fn();

    render(CopilotKitProvider, {
      props: {
        runtimeUrl: "http://localhost:59999/nonexistent",
        onError,
      },
      slots: { default: "<div>child</div>" },
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    const event = onError.mock.calls[0][0] as {
      error: Error;
      code: CopilotKitCoreErrorCode;
    };

    expect(event.code).toBe(CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED);
    expect(event.error).toBeInstanceOf(Error);
    expect(event.error.message).toContain("network failure");
  });

  it("onError fires without publicApiKey", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
    const onError = vi.fn();

    render(CopilotKitProvider, {
      props: {
        runtimeUrl: "http://localhost:59999/nonexistent",
        onError,
      },
      slots: { default: "<div>child</div>" },
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });
});
