import { HttpAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";

const keepLast = (messages: Message[]) => messages.slice(-1);

function createCore() {
  return new CopilotKitCore({
    runtimeUrl: "https://runtime.example/a",
    deferInitialConnection: true,
    headers: { "x-tenant": "acme" },
    credentials: "include",
    messageFilter: keepLast,
    properties: { mode: "a" },
    debug: true,
    defaultThrottleMs: 50,
  });
}

describe("CopilotKitCore.ɵupdateConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies every key that is present", () => {
    const core = createCore();
    const agent = new HttpAgent({ url: "https://agents.example/a" });
    const filter = (messages: Message[]) => messages;
    core.ɵupdateConfig({
      messageFilter: filter,
      runtimeUrl: "https://runtime.example/b",
      runtimeTransport: "single",
      headers: { "x-tenant": "globex" },
      credentials: "same-origin",
      properties: { mode: "b" },
      agents__unsafe_dev_only: { a: agent },
      debug: false,
      defaultThrottleMs: 0,
    });
    expect(core.messageFilter).toBe(filter);
    expect(core.runtimeUrl).toBe("https://runtime.example/b");
    expect(core.runtimeTransport).toBe("single");
    expect(core.headers).toEqual({ "x-tenant": "globex" });
    expect(core.credentials).toBe("same-origin");
    expect(core.properties).toEqual({ mode: "b" });
    expect(core.agents.a).toBe(agent);
    expect(core.debug).toBe(false);
    expect(core.defaultThrottleMs).toBe(0);
    core.dispose();
  });

  it("leaves absent keys alone", () => {
    const core = createCore();
    core.ɵupdateConfig({ debug: false });
    expect(core.runtimeUrl).toBe("https://runtime.example/a");
    expect(core.headers).toEqual({ "x-tenant": "acme" });
    expect(core.credentials).toBe("include");
    expect(core.messageFilter).toBe(keepLast);
    expect(core.properties).toEqual({ mode: "a" });
    expect(core.defaultThrottleMs).toBe(50);
    core.dispose();
  });

  it("clears a key that is present with undefined", () => {
    const core = createCore();
    core.ɵupdateConfig({
      runtimeUrl: undefined,
      messageFilter: undefined,
      credentials: undefined,
      headers: undefined,
      properties: undefined,
      defaultThrottleMs: undefined,
    });
    expect(core.runtimeUrl).toBeUndefined();
    expect(core.messageFilter).toBeUndefined();
    expect(core.credentials).toBeUndefined();
    expect(core.headers).toEqual({});
    expect(core.properties).toEqual({});
    expect(core.defaultThrottleMs).toBeUndefined();
    core.dispose();
  });

  it("keeps the throttle when the new value is invalid", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const core = createCore();
    core.ɵupdateConfig({ defaultThrottleMs: -1 });
    expect(core.defaultThrottleMs).toBe(50);
    core.dispose();
  });
});

describe("CopilotKitCore error handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Report one error through the core: an invalid throttle value. */
  function reportError(core: CopilotKitCore) {
    core.setDefaultThrottleMs(-1);
  }

  it("logs in the [CopilotKit] format when no handler is set", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const core = new CopilotKitCore({});
    reportError(core);
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[CopilotKit] Error (subscriber_callback_failed):",
        expect.any(Error),
        { value: -1, currentValue: undefined },
      ),
    );
  });

  it("calls the onError config handler instead of logging", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const core = new CopilotKitCore({ onError });
    reportError(core);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: CopilotKitCoreErrorCode.SUBSCRIBER_CALLBACK_FAILED,
      context: { value: -1, currentValue: undefined },
    });
    const formatted = error.mock.calls.filter(
      ([first]) =>
        typeof first === "string" && first.startsWith("[CopilotKit] Error ("),
    );
    expect(formatted).toEqual([]);
  });

  it("goes back to logging after setErrorHandler(undefined)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const core = new CopilotKitCore({ onError });
    core.setErrorHandler(undefined);
    reportError(core);
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[CopilotKit] Error (subscriber_callback_failed):",
        expect.any(Error),
        expect.anything(),
      ),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("logs a handler that throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("handler broke");
    const core = new CopilotKitCore({
      onError: () => {
        throw failure;
      },
    });
    reportError(core);
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[CopilotKit] onError handler failed:",
        failure,
      ),
    );
  });

  it("does not call the handler after dispose", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const core = new CopilotKitCore({ onError });
    core.dispose();
    reportError(core);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
  });
});
