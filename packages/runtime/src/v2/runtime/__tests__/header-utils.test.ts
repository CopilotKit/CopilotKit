import { describe, it, expect } from "vitest";
import {
  shouldForwardHeader,
  extractForwardableHeaders,
} from "../handlers/header-utils";

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

    it("blocks hop-by-hop and platform headers from the inbound hop", () => {
      expect(shouldForwardHeader("x-forwarded-for")).toBe(false);
      expect(shouldForwardHeader("X-Forwarded-For")).toBe(false);
      expect(shouldForwardHeader("x-forwarded-proto")).toBe(false);
      expect(shouldForwardHeader("x-real-ip")).toBe(false);
      expect(shouldForwardHeader("x-cloud-trace-context")).toBe(false);
      expect(shouldForwardHeader("X-Serverless-Authorization")).toBe(false);
      expect(shouldForwardHeader("x-vercel-id")).toBe(false);
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

    it("drops platform headers so they don't reach the upstream agent", () => {
      const request = new Request("https://example.com", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-token",
          "X-Serverless-Authorization": "Bearer platform-token",
          "X-Forwarded-For": "203.0.113.1",
          "X-Cloud-Trace-Context": "trace/span",
          "X-Custom": "keep-me",
        },
      });

      const result = extractForwardableHeaders(request);

      expect(result).toEqual({
        authorization: "Bearer service-token",
        "x-custom": "keep-me",
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
});
