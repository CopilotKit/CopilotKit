import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("playwright");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function failureDiagnostics(message: string) {
  vi.resetModules();
  vi.stubEnv("FRONTEND_URL", "http://frontend.test");
  vi.stubEnv("REMOTE_COPILOTKIT_URL", "http://runtime.test/copilotkit");
  vi.stubEnv("PROMPT", "Render the test dashboard");

  const response = {
    status: () => 200,
    text: async () =>
      `data: ${JSON.stringify({ type: "RUN_ERROR", code: message, message })}\n`,
  };
  const route = {
    request: () => ({
      postDataJSON: () => ({ method: "agent/run" }),
      method: () => "POST",
    }),
    fetch: vi.fn().mockResolvedValue(response),
    fulfill: vi.fn().mockResolvedValue(undefined),
  };
  const handlers = new Map<string, (payload: unknown) => void>();
  let routeHandler: ((value: typeof route) => Promise<void>) | undefined;
  const originalError = new Error("surface did not render");
  const surfaceLocator = {
    waitFor: vi.fn().mockRejectedValue(originalError),
  };
  const page = {
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    },
    route: async (
      _pattern: string,
      handler: (value: typeof route) => Promise<void>,
    ) => {
      routeHandler = handler;
    },
    goto: async () => {
      handlers.get("pageerror")!(new Error(message));
      handlers.get("requestfailed")!({
        resourceType: () => "fetch",
        failure: () => ({ errorText: message }),
      });
      await routeHandler!(route);
    },
    getByPlaceholder: () => ({
      fill: vi.fn().mockResolvedValue(undefined),
      inputValue: async () => "Render the test dashboard",
    }),
    getByTestId: () => ({ click: vi.fn().mockResolvedValue(undefined) }),
    getByText: () => surfaceLocator,
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // Isolate the browser boundary while executing the actual probe and logger.
  vi.doMock("playwright", () => ({
    chromium: { launch: vi.fn().mockResolvedValue(browser) },
  }));
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  const scriptPath = "./d6-gen-ui-remote.mjs";
  await expect(import(scriptPath)).rejects.toBe(originalError);
  expect(browser.close).toHaveBeenCalledOnce();
  expect(surfaceLocator.waitFor).toHaveBeenCalledWith({ timeout: 90_000 });
  expect(errorLog).toHaveBeenCalledOnce();
  expect(errorLog.mock.calls[0]?.[0]).toBe("Remote A2UI failure diagnostics:");
  return JSON.parse(errorLog.mock.calls[0]![1] as string);
}

describe("remote D6 probe failure diagnostics", () => {
  it.each([
    {
      name: "PostgreSQL username and password",
      message:
        "connect postgres://dummy-user:dummy-pass@db.test:5432/app failed",
      expected: "connect postgres://[redacted]@db.test:5432/app failed",
    },
    {
      name: "Redis userinfo token",
      message: "connect redis://dummy-token@cache.test:6379/0 failed",
      expected: "connect redis://[redacted]@cache.test:6379/0 failed",
    },
    {
      name: "mixed-case MongoDB+srv scheme",
      message:
        "connect MoNgOdB+SrV://dummy-user:dummy-pass@cluster.test/app failed",
      expected: "connect MoNgOdB+SrV://[redacted]@cluster.test/app failed",
    },
    {
      name: "multiple at signs in one authority",
      message: "connect postgres://dummy-user:dummy@pass@db.test/app failed",
      expected: "connect postgres://[redacted]@db.test/app failed",
    },
    {
      name: "query email without URI userinfo",
      message: "redis://cache.test/0?email=dummy@example.test",
      expected: "redis://cache.test/0?email=dummy@example.test",
    },
    {
      name: "query email without a path or URI userinfo",
      message: "redis://cache.test?email=dummy@example.test",
      expected: "redis://cache.test?email=dummy@example.test",
    },
    {
      name: "fragment email without URI userinfo",
      message: "redis://cache.test#dummy@example.test",
      expected: "redis://cache.test#dummy@example.test",
    },
    {
      name: "existing HTTP, HTTPS, API key, and bearer redactions",
      message:
        "http://dummy:pass@one.test/path https://two.test/?token=dummy sk-dummy Bearer dummy-token",
      expected: "[URL] [URL] [redacted] [redacted]",
    },
    {
      name: "500-character cap after redaction",
      message: `redis://dummy-token@cache.test/0 ${"x".repeat(600)}`,
      expected: `redis://[redacted]@cache.test/0 ${"x".repeat(600)}`.slice(
        0,
        500,
      ),
    },
  ])(
    "preserves diagnostic structure for $name",
    async ({ message, expected }) => {
      const diagnostics = await failureDiagnostics(message);

      expect(diagnostics).toEqual({
        requests: [{ httpMethod: "POST", method: "agent/run", status: 200 }],
        eventTypes: { RUN_ERROR: 1 },
        runErrors: [{ code: expected, message: expected }],
        pageErrors: [expected],
        requestFailures: [{ resourceType: "fetch", error: expected }],
        composerContainsPrompt: true,
      });
    },
  );
});
