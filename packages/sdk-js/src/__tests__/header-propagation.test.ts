import { describe, it, expect } from "vitest";
import {
  withForwardedHeaders,
  getForwardedHeaders,
} from "../header-propagation";

describe("header-propagation", () => {
  describe("getForwardedHeaders", () => {
    it("returns empty object when called outside withForwardedHeaders scope", () => {
      const headers = getForwardedHeaders();
      expect(headers).toEqual({});
    });
  });

  describe("withForwardedHeaders", () => {
    it("filters to only x-* prefixed headers", () => {
      const input = {
        "x-aimock-strict": "true",
        "x-aimock-fixture": "demo",
        "x-request-id": "req-123",
        "x-custom-trace": "abc",
        authorization: "Bearer secret",
        "content-type": "application/json",
      };

      withForwardedHeaders(input, () => {
        const forwarded = getForwardedHeaders();
        expect(forwarded).toEqual({
          "x-aimock-strict": "true",
          "x-aimock-fixture": "demo",
          "x-request-id": "req-123",
          "x-custom-trace": "abc",
        });
        expect(forwarded).not.toHaveProperty("authorization");
        expect(forwarded).not.toHaveProperty("content-type");
      });
    });

    it("lowercases header keys", () => {
      const input = {
        "X-AIMock-Strict": "true",
        "X-AIMOCK-FIXTURE": "demo",
      };

      withForwardedHeaders(input, () => {
        const forwarded = getForwardedHeaders();
        expect(forwarded).toEqual({
          "x-aimock-strict": "true",
          "x-aimock-fixture": "demo",
        });
      });
    });

    it("returns empty when no x-* headers present", () => {
      const input = {
        authorization: "Bearer token",
        "content-type": "application/json",
      };

      withForwardedHeaders(input, () => {
        const forwarded = getForwardedHeaders();
        expect(forwarded).toEqual({});
      });
    });

    it("returns the callback's return value", () => {
      const result = withForwardedHeaders({}, () => 42);
      expect(result).toBe(42);
    });

    it("restores empty state after scope exits", () => {
      withForwardedHeaders({ "x-aimock-strict": "true" }, () => {
        expect(getForwardedHeaders()).toEqual({ "x-aimock-strict": "true" });
      });

      // Outside the scope, should be empty again
      expect(getForwardedHeaders()).toEqual({});
    });
  });

  describe("AsyncLocalStorage isolation", () => {
    it("maintains separate headers across concurrent requests", async () => {
      const results: Record<string, string>[] = [];

      const request1 = new Promise<void>((resolve) => {
        withForwardedHeaders({ "x-aimock-strict": "true" }, () => {
          // Simulate async work
          setTimeout(() => {
            results.push(getForwardedHeaders());
            resolve();
          }, 10);
        });
      });

      const request2 = new Promise<void>((resolve) => {
        withForwardedHeaders({ "x-aimock-fixture": "demo" }, () => {
          // Simulate async work
          setTimeout(() => {
            results.push(getForwardedHeaders());
            resolve();
          }, 5);
        });
      });

      await Promise.all([request1, request2]);

      // Each request should have its own headers, regardless of timing
      expect(results).toHaveLength(2);
      const strictResult = results.find((r) => "x-aimock-strict" in r);
      const fixtureResult = results.find((r) => "x-aimock-fixture" in r);
      expect(strictResult).toEqual({ "x-aimock-strict": "true" });
      expect(fixtureResult).toEqual({ "x-aimock-fixture": "demo" });
    });

    it("works with nested withForwardedHeaders calls", () => {
      withForwardedHeaders({ "x-aimock-strict": "true" }, () => {
        expect(getForwardedHeaders()).toEqual({ "x-aimock-strict": "true" });

        // Inner scope overrides outer
        withForwardedHeaders({ "x-aimock-fixture": "inner" }, () => {
          expect(getForwardedHeaders()).toEqual({
            "x-aimock-fixture": "inner",
          });
        });

        // Back to outer scope
        expect(getForwardedHeaders()).toEqual({ "x-aimock-strict": "true" });
      });
    });
  });
});
