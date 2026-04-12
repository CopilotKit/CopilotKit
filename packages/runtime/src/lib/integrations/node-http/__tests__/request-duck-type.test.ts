import { describe, it, expect } from "vitest";

/**
 * Test for #2986: instanceof Request fails with @hono/node-server polyfill
 *
 * When Hono polyfills the Request class, `instanceof Request` fails because
 * the polyfilled Request has a different prototype. We need duck-type checking.
 */

// Simulates a polyfilled Request object that does NOT pass instanceof Request
function createPolyfillRequest(url: string, method: string = "GET"): object {
  return {
    url,
    method,
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
    clone: () => createPolyfillRequest(url, method),
  };
}

// This is the duck-type check that should replace instanceof
function isRequestLike(obj: unknown): obj is Request {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "url" in obj &&
    "method" in obj &&
    "headers" in obj &&
    typeof (obj as any).url === "string" &&
    typeof (obj as any).method === "string"
  );
}

describe("Request duck-type detection (#2986)", () => {
  it("should detect a native Request object", () => {
    const req = new Request("http://localhost:3000/api/copilotkit", {
      method: "POST",
    });
    expect(isRequestLike(req)).toBe(true);
    expect(req instanceof Request).toBe(true);
  });

  it("should detect a polyfilled Request object that fails instanceof", () => {
    const polyfilled = createPolyfillRequest(
      "http://localhost:3000/api/copilotkit",
      "POST",
    );

    // instanceof fails for polyfilled objects
    expect(polyfilled instanceof Request).toBe(false);

    // But duck-type check succeeds
    expect(isRequestLike(polyfilled)).toBe(true);
  });

  it("should NOT match null or undefined", () => {
    expect(isRequestLike(null)).toBe(false);
    expect(isRequestLike(undefined)).toBe(false);
  });

  it("should NOT match an object missing required properties", () => {
    expect(isRequestLike({ url: "http://test.com" })).toBe(false);
    expect(isRequestLike({ method: "GET" })).toBe(false);
    expect(isRequestLike({})).toBe(false);
  });
});
