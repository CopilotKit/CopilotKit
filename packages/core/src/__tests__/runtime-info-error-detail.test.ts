import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";

/**
 * The runtime answers a transport mismatch with a 404 that explains the cause
 * (the `single_route_envelope_against_multi_route_runtime` diagnostic). That
 * explanation is only worth emitting if the client surfaces it — before
 * OSS-882 the response body was discarded and the developer saw nothing but a
 * status code.
 */
describe("runtime info failures surface the server's explanation", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  const DIAGNOSTIC = {
    error: "Not found",
    code: "single_route_envelope_against_multi_route_runtime",
    message:
      'Received a single-route request envelope ({ method: "..." }) but this runtime is mounted in multi-route mode. Pass useSingleEndpoint={false}.',
  };

  const respond = (
    body: unknown,
    status = 404,
    contentType = "application/json",
  ) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": contentType },
    });

  const mockFetch = (response: Response) => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(response.clone()),
      ) as unknown as typeof fetch;
  };

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  /**
   * The path the reported failure actually took: the compat provider forces
   * `useSingleEndpoint`, so the core's startup `/info` handshake POSTs an
   * envelope and the multi-route runtime 404s it.
   */
  const connectAndCaptureError = async (
    body: unknown,
    status = 404,
    contentType?: string,
  ) => {
    mockFetch(respond(body, status, contentType));

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example/api/copilotkit",
      runtimeTransport: "single",
    });
    const errors: Array<{ code: CopilotKitCoreErrorCode; error: Error }> = [];
    const sub = core.subscribe({
      onError: (e) => void errors.push(e as never),
    });

    await vi.waitFor(() => {
      expect(
        errors.some(
          (e) => e.code === CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
        ),
      ).toBe(true);
    });
    sub.unsubscribe();

    return errors.find(
      (e) => e.code === CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
    )!.error;
  };

  describe("core /info handshake", () => {
    it("names useSingleEndpoint when the runtime diagnoses the mismatch", async () => {
      const error = await connectAndCaptureError(DIAGNOSTIC);
      expect(error.message).toContain("useSingleEndpoint");
    });

    it("keeps the status alongside the explanation", async () => {
      const error = await connectAndCaptureError(DIAGNOSTIC);
      expect(error.message).toContain(
        "Runtime info request failed with status 404",
      );
    });

    it("falls back to the bare status when the body carries no message", async () => {
      const error = await connectAndCaptureError({ error: "Not found" });
      expect(error.message).toBe("Runtime info request failed with status 404");
    });

    it("survives a non-JSON error body", async () => {
      const error = await connectAndCaptureError(
        "<html>gateway</html>",
        502,
        "text/html",
      );
      expect(error.message).toBe("Runtime info request failed with status 502");
    });

    it("ignores a non-string message field", async () => {
      const error = await connectAndCaptureError({ message: { nested: true } });
      expect(error.message).toBe("Runtime info request failed with status 404");
    });
  });

  describe("ProxiedCopilotRuntimeAgent", () => {
    it("surfaces the explanation on the auto-detect fallback", async () => {
      mockFetch(respond(DIAGNOSTIC));

      const agent = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: "https://runtime.example/api/copilotkit",
        agentId: "remote",
        transport: "auto",
      });

      await expect(agent.runAgent({})).rejects.toThrow(/useSingleEndpoint/);
    });

    it("leaves a message-less failure as the bare status", async () => {
      mockFetch(respond({ error: "Not found" }));

      const agent = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: "https://runtime.example/api/copilotkit",
        agentId: "remote",
        transport: "auto",
      });

      await expect(agent.runAgent({})).rejects.toThrow(
        "Runtime info request failed with status 404",
      );
    });
  });
});
