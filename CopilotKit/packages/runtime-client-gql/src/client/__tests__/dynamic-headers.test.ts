import { describe, test, expect, vi, beforeEach } from "vitest";
import { CopilotRuntimeClient } from "../CopilotRuntimeClient";

vi.mock("urql", () => ({
  Client: vi.fn().mockImplementation((options) => ({
    mutation: vi.fn().mockReturnValue({ toPromise: () => Promise.resolve({}) }),
    _fetchOptions: options.fetchOptions,
  })),
  cacheExchange: {},
  fetchExchange: {},
}));

describe("CopilotRuntimeClient dynamic headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should accept static headers object (backward compatibility)", () => {
    const client = new CopilotRuntimeClient({
      url: "http://test.com",
      headers: { "Authorization": "Bearer static-token" },
    });
    expect(client).toBeDefined();
  });

  test("should accept headers as a function", () => {
    const headersFunction = () => ({ "Authorization": "Bearer dynamic-token" });
    const client = new CopilotRuntimeClient({
      url: "http://test.com",
      headers: headersFunction,
    });
    expect(client).toBeDefined();
  });

  test("should call headers function for each request", () => {
    let callCount = 0;
    const headersFunction = vi.fn(() => {
      callCount++;
      return { "Authorization": `Bearer token-${callCount}` };
    });

    const client = new CopilotRuntimeClient({
      url: "http://test.com",
      headers: headersFunction,
    });

    const urqlClient = (client as any).client;
    const fetchOptions = urqlClient._fetchOptions;

    // Call fetchOptions multiple times (simulating multiple requests)
    const result1 = typeof fetchOptions === "function" ? fetchOptions() : fetchOptions;
    const result2 = typeof fetchOptions === "function" ? fetchOptions() : fetchOptions;

    // Headers function should be called for each request
    expect(headersFunction).toHaveBeenCalledTimes(2);
    expect(result1.headers["Authorization"]).toBe("Bearer token-1");
    expect(result2.headers["Authorization"]).toBe("Bearer token-2");
  });

  test("should merge headers function result with publicApiKey", () => {
    const headersFunction = () => ({ "Custom-Header": "custom-value" });
    const client = new CopilotRuntimeClient({
      url: "http://test.com",
      headers: headersFunction,
      publicApiKey: "test-api-key",
    });

    const urqlClient = (client as any).client;
    const fetchOptions =
      typeof urqlClient._fetchOptions === "function"
        ? urqlClient._fetchOptions()
        : urqlClient._fetchOptions;

    expect(fetchOptions.headers["Custom-Header"]).toBe("custom-value");
    expect(fetchOptions.headers["x-copilotcloud-public-api-key"]).toBe("test-api-key");
  });
});
