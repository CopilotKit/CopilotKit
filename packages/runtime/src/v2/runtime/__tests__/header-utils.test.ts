import { describe, it, expect } from "vitest";
import {
  shouldForwardHeader,
  extractForwardableHeaders,
  mergeForwardableHeaders,
} from "../handlers/header-utils";

// No forwardable inbound headers, so a merge's result is driven purely by the
// server-configured `serverHeaders`.
function noForwardRequest(): Request {
  return new Request("https://example.com/api/copilotkit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

function authKeys(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter(
    (k) => k.toLowerCase() === "authorization",
  );
}

describe("header-utils", () => {
  describe("shouldForwardHeader", () => {
    it("forwards authorization header (case-insensitive)", () => {
      expect(shouldForwardHeader("authorization")).toBe(true);
      expect(shouldForwardHeader("Authorization")).toBe(true);
      expect(shouldForwardHeader("AUTHORIZATION")).toBe(true);
    });

    it("forwards x-* custom headers", () => {
      expect(shouldForwardHeader("x-custom")).toBe(true);
      expect(shouldForwardHeader("X-Custom")).toBe(true);
      expect(shouldForwardHeader("x-request-id")).toBe(true);
      expect(shouldForwardHeader("X-Forwarded-For")).toBe(true);
    });

    it("blocks standard headers", () => {
      expect(shouldForwardHeader("content-type")).toBe(false);
      expect(shouldForwardHeader("Content-Type")).toBe(false);
      expect(shouldForwardHeader("origin")).toBe(false);
      expect(shouldForwardHeader("user-agent")).toBe(false);
      expect(shouldForwardHeader("accept")).toBe(false);
      expect(shouldForwardHeader("cookie")).toBe(false);
      expect(shouldForwardHeader("host")).toBe(false);
    });
  });

  describe("extractForwardableHeaders", () => {
    it("extracts only forwardable headers from request", () => {
      const request = new Request("https://example.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Custom": "custom-value",
          "X-Request-ID": "req-123",
          Authorization: "Bearer token",
          Origin: "http://localhost",
        },
      });

      const result = extractForwardableHeaders(request);

      expect(result).toEqual({
        "x-custom": "custom-value",
        "x-request-id": "req-123",
        authorization: "Bearer token",
      });
    });

    it("returns empty object when no forwardable headers present", () => {
      const request = new Request("https://example.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
      });

      const result = extractForwardableHeaders(request);

      expect(result).toEqual({});
    });

    it("preserves header values exactly", () => {
      const request = new Request("https://example.com", {
        method: "POST",
        headers: {
          Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
          "X-Complex-Value": "value with spaces and special=chars&more",
        },
      });

      const result = extractForwardableHeaders(request);

      expect(result.authorization).toBe(
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      );
      expect(result["x-complex-value"]).toBe(
        "value with spaces and special=chars&more",
      );
    });
  });

  describe("mergeForwardableHeaders — server-vs-server case collision", () => {
    it("collapses a server-self authorization case-collision to a single first-occurrence-wins entry", () => {
      // The agent itself is configured with BOTH case-variants of the same
      // header. A plain `{ ...base }` spread keeps both keys, which undici
      // comma-joins into an invalid "multiple JWTs" value.
      const serverHeaders: Record<string, string> = {
        Authorization: "Bearer FIRST",
        authorization: "Bearer SECOND",
      };

      const merged = mergeForwardableHeaders(serverHeaders, noForwardRequest());

      // Exactly one authorization-family key may survive...
      expect(authKeys(merged)).toHaveLength(1);
      // ...carrying the documented winner (first occurrence: canonical
      // `Authorization` with value `Bearer FIRST`).
      const key = authKeys(merged)[0];
      expect(key).toBe("Authorization");
      expect(merged[key]).toBe("Bearer FIRST");
    });

    it("collapses a server-self x-* case-collision to a single first-occurrence-wins entry", () => {
      const serverHeaders: Record<string, string> = {
        "X-Service-Key": "first",
        "x-service-key": "second",
      };

      const merged = mergeForwardableHeaders(serverHeaders, noForwardRequest());

      const keys = Object.keys(merged).filter(
        (k) => k.toLowerCase() === "x-service-key",
      );
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe("X-Service-Key");
      expect(merged[keys[0]]).toBe("first");
    });

    it("still lets non-colliding inbound headers forward after server-self dedup", () => {
      const serverHeaders: Record<string, string> = {
        Authorization: "Bearer FIRST",
        authorization: "Bearer SECOND",
      };
      const request = new Request("https://example.com/api/copilotkit", {
        method: "POST",
        headers: { "X-Request-Id": "req-123" },
      });

      const merged = mergeForwardableHeaders(serverHeaders, request);

      expect(authKeys(merged)).toHaveLength(1);
      expect(merged["x-request-id"]).toBe("req-123");
    });
  });
});
