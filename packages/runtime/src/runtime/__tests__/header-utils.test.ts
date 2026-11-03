import { describe, it, expect } from "vitest";
import {
  shouldForwardHeader,
  extractForwardableHeaders,
  mergeForwardableHeaders,
  resolveForwardHeadersPolicy,
} from "../handlers/header-utils";
import type { ResolvedForwardHeadersPolicy } from "../handlers/header-utils";

// Default resolved policy (built-in infra/platform denylist active) — the
// behavior every integrator gets on upgrade unless they opt out.
const defaultPolicy: ResolvedForwardHeadersPolicy =
  resolveForwardHeadersPolicy(undefined);

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
  describe("shouldForwardHeader — default policy", () => {
    it("forwards authorization header (case-insensitive)", () => {
      expect(shouldForwardHeader("authorization", defaultPolicy)).toBe(true);
      expect(shouldForwardHeader("Authorization", defaultPolicy)).toBe(true);
      expect(shouldForwardHeader("AUTHORIZATION", defaultPolicy)).toBe(true);
    });

    it("forwards legitimate custom x-* application headers", () => {
      expect(shouldForwardHeader("x-custom", defaultPolicy)).toBe(true);
      expect(shouldForwardHeader("X-Custom", defaultPolicy)).toBe(true);
      expect(shouldForwardHeader("x-tenant-id", defaultPolicy)).toBe(true);
      expect(shouldForwardHeader("x-api-key", defaultPolicy)).toBe(true);
      expect(shouldForwardHeader("x-user-id", defaultPolicy)).toBe(true);
      expect(shouldForwardHeader("x-feature-flag", defaultPolicy)).toBe(true);
    });

    it("blocks standard non-x non-auth headers", () => {
      expect(shouldForwardHeader("content-type", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("Content-Type", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("origin", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("user-agent", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("accept", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("cookie", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("host", defaultPolicy)).toBe(false);
      // RFC 7239 `forwarded` lacks the x- prefix, so base eligibility already
      // drops it before the denylist is consulted.
      expect(shouldForwardHeader("forwarded", defaultPolicy)).toBe(false);
    });

    it("strips known infra/proxy/platform headers by exact name", () => {
      // These were forwarded by the old wide-open `x-*` allowlist — the leak.
      expect(shouldForwardHeader("x-forwarded-for", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-forwarded-proto", defaultPolicy)).toBe(
        false,
      );
      expect(shouldForwardHeader("x-forwarded-host", defaultPolicy)).toBe(
        false,
      );
      expect(shouldForwardHeader("x-forwarded-port", defaultPolicy)).toBe(
        false,
      );
      expect(shouldForwardHeader("x-forwarded-server", defaultPolicy)).toBe(
        false,
      );
      expect(shouldForwardHeader("x-real-ip", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-amzn-trace-id", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-cloud-trace-context", defaultPolicy)).toBe(
        false,
      );
      expect(shouldForwardHeader("x-cache", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-served-by", defaultPolicy)).toBe(false);
      // The old assertions at lines 34-35 INVERT under the default policy:
      // these used to forward, now they are stripped.
      expect(shouldForwardHeader("x-request-id", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("X-Forwarded-For", defaultPolicy)).toBe(false);
      // The highest-severity item: the Copilot Cloud platform key.
      expect(
        shouldForwardHeader("x-copilotcloud-public-api-key", defaultPolicy),
      ).toBe(false);
    });

    it("strips known infra/platform header families by prefix", () => {
      expect(shouldForwardHeader("x-amz-cf-id", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-amz-anything", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-azure-ref", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-azure-clientip", defaultPolicy)).toBe(
        false,
      );
      expect(shouldForwardHeader("x-fastly-foo", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-vercel-id", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("x-vercel-ip-country", defaultPolicy)).toBe(
        false,
      );
      expect(shouldForwardHeader("x-middleware-rewrite", defaultPolicy)).toBe(
        false,
      );
      expect(
        shouldForwardHeader("x-copilotcloud-internal", defaultPolicy),
      ).toBe(false);
    });

    it("strips denylisted headers case-insensitively", () => {
      expect(shouldForwardHeader("X-Forwarded-For", defaultPolicy)).toBe(false);
      expect(
        shouldForwardHeader("X-COPILOTCLOUD-PUBLIC-API-KEY", defaultPolicy),
      ).toBe(false);
      expect(shouldForwardHeader("X-Vercel-Id", defaultPolicy)).toBe(false);
    });
  });

  describe("shouldForwardHeader — config overrides", () => {
    it("useDefaultDenylist:false restores the old wide-open behavior", () => {
      const policy = resolveForwardHeadersPolicy({ useDefaultDenylist: false });
      // The pre-fix behavior: x-* infra headers forward again.
      expect(shouldForwardHeader("x-forwarded-for", policy)).toBe(true);
      expect(shouldForwardHeader("x-request-id", policy)).toBe(true);
      expect(shouldForwardHeader("x-copilotcloud-public-api-key", policy)).toBe(
        true,
      );
      expect(shouldForwardHeader("authorization", policy)).toBe(true);
    });

    it("deny extends the default set with additional exact names", () => {
      const policy = resolveForwardHeadersPolicy({ deny: ["x-internal"] });
      // The extra custom header is stripped...
      expect(shouldForwardHeader("x-internal", policy)).toBe(false);
      // ...while the built-in defaults stay active...
      expect(shouldForwardHeader("x-forwarded-for", policy)).toBe(false);
      // ...and unrelated custom headers still forward.
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
    });

    it("denyPrefixes extends the default set with additional prefixes", () => {
      const policy = resolveForwardHeadersPolicy({ denyPrefixes: ["x-acme-"] });
      expect(shouldForwardHeader("x-acme-secret", policy)).toBe(false);
      expect(shouldForwardHeader("x-acme-anything", policy)).toBe(false);
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
    });

    it("allow switches to allowlist mode — only listed headers forward", () => {
      const policy = resolveForwardHeadersPolicy({
        allow: ["authorization", "x-tenant-id"],
      });
      expect(shouldForwardHeader("authorization", policy)).toBe(true);
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
      // Allowlist mode short-circuits the usual x-*/authorization eligibility:
      // anything not explicitly allowed is dropped, including custom x-* and
      // denylisted infra.
      expect(shouldForwardHeader("x-other-custom", policy)).toBe(false);
      expect(shouldForwardHeader("x-forwarded-for", policy)).toBe(false);
    });

    it("handles the bare 'x' name and the empty-string name under both policies", () => {
      // Default (denylist) policy: base eligibility is `authorization` or any
      // `x-*`. A header literally named "x" is NOT `x-`-prefixed, and the
      // empty-string name is neither — both are ineligible, so neither forwards.
      expect(shouldForwardHeader("x", defaultPolicy)).toBe(false);
      expect(shouldForwardHeader("", defaultPolicy)).toBe(false);

      // Allowlist mode short-circuits the usual eligibility entirely: forward
      // iff the (lowercased) name is explicitly listed. Neither "x" nor "" is in
      // this allowlist, so both are dropped...
      const allowPolicy = resolveForwardHeadersPolicy({
        allow: ["authorization", "x-tenant-id"],
      });
      expect(shouldForwardHeader("x", allowPolicy)).toBe(false);
      expect(shouldForwardHeader("", allowPolicy)).toBe(false);

      // ...but allowlist mode is purely membership-driven, so explicitly listing
      // a NON-EMPTY otherwise-ineligible name (`x`) DOES make it forward (the
      // allowlist overrides the `x-*`/`authorization` eligibility rule entirely).
      // The empty-string entry is filtered out during resolution (see the
      // empty-string validation tests), so `""` never forwards — and because a
      // non-empty entry remains, allowlist mode is still active and exclusive.
      const explicitPolicy = resolveForwardHeadersPolicy({ allow: ["x", ""] });
      expect(shouldForwardHeader("x", explicitPolicy)).toBe(true);
      expect(shouldForwardHeader("", explicitPolicy)).toBe(false);
      // And a normally-eligible header is dropped, confirming allowlist mode
      // is active and exclusive.
      expect(shouldForwardHeader("authorization", explicitPolicy)).toBe(false);
    });

    it("allow is case-insensitive", () => {
      const policy = resolveForwardHeadersPolicy({ allow: ["X-Tenant-Id"] });
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
      expect(shouldForwardHeader("X-TENANT-ID", policy)).toBe(true);
      expect(shouldForwardHeader("authorization", policy)).toBe(false);
    });
  });

  describe("shouldForwardHeader — deny wins in allowlist mode", () => {
    it("deny subtracts an exact name from allow (a header in BOTH is NOT forwarded)", () => {
      // The footgun: an integrator lists a header in allow AND explicitly denies
      // it. deny is authoritative — the denied header must not forward, even
      // though it is also allowed, while the other allowed header still does.
      const policy = resolveForwardHeadersPolicy({
        allow: ["x-keep", "x-secret"],
        deny: ["x-secret"],
      });
      expect(shouldForwardHeader("x-secret", policy)).toBe(false);
      expect(shouldForwardHeader("x-keep", policy)).toBe(true);
    });

    it("deny in allow mode is case-insensitive", () => {
      const policy = resolveForwardHeadersPolicy({
        allow: ["X-Keep", "X-Secret"],
        deny: ["X-SECRET"],
      });
      expect(shouldForwardHeader("x-secret", policy)).toBe(false);
      expect(shouldForwardHeader("X-Secret", policy)).toBe(false);
      expect(shouldForwardHeader("x-keep", policy)).toBe(true);
    });

    it("denyPrefixes subtracts a matching allowed header in allowlist mode", () => {
      // A header allowed by exact name but matched by an integrator denyPrefix
      // is still stripped — deny (prefix form) is authoritative in allow mode.
      const policy = resolveForwardHeadersPolicy({
        allow: ["x-internal-token", "x-tenant-id"],
        denyPrefixes: ["x-internal-"],
      });
      expect(shouldForwardHeader("x-internal-token", policy)).toBe(false);
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
    });

    it("the DEFAULT denylist does NOT subtract in allow mode — explicit allow opts back in", () => {
      // Only the integrator's OWN deny subtracts from an allowlist. A header on
      // the built-in default denylist that the integrator explicitly allows is
      // forwarded — the allow is a deliberate opt-in, not a footgun.
      const policy = resolveForwardHeadersPolicy({
        allow: ["x-forwarded-for", "x-request-id"],
      });
      expect(shouldForwardHeader("x-forwarded-for", policy)).toBe(true);
      expect(shouldForwardHeader("x-request-id", policy)).toBe(true);
    });
  });

  describe("resolveForwardHeadersPolicy — empty/whitespace entry validation", () => {
    it("filters an empty-string denyPrefix so it cannot deny ALL forwarding", () => {
      // `denyPrefixes: [""]` would make `startsWith("")` true for every header,
      // silently denying ALL forwarding. The empty entry must be filtered so
      // normal headers still forward under the default policy.
      const policy = resolveForwardHeadersPolicy({ denyPrefixes: [""] });
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
      expect(shouldForwardHeader("authorization", policy)).toBe(true);
      // The default denylist is still intact.
      expect(shouldForwardHeader("x-forwarded-for", policy)).toBe(false);
    });

    it("filters whitespace-only denyPrefix and deny entries", () => {
      const policy = resolveForwardHeadersPolicy({
        denyPrefixes: ["   "],
        deny: [" \t"],
      });
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
      expect(shouldForwardHeader("authorization", policy)).toBe(true);
    });

    it("filters whitespace-only allow entries so allowlist mode is not silently seeded", () => {
      // `allow: [" "]` would (pre-fix) switch on the exclusive allowlist with an
      // entry that can never match a real header — forwarding nothing. After the
      // fix the whitespace entry is filtered, leaving no allowlist, so the
      // default denylist behavior applies and normal headers forward.
      const policy = resolveForwardHeadersPolicy({ allow: [" "] });
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
      expect(shouldForwardHeader("authorization", policy)).toBe(true);
    });

    it("trims surrounding whitespace on entries before matching", () => {
      const policy = resolveForwardHeadersPolicy({
        deny: ["  x-secret  "],
        denyPrefixes: [" x-internal- "],
        allow: undefined,
      });
      expect(shouldForwardHeader("x-secret", policy)).toBe(false);
      expect(shouldForwardHeader("x-internal-token", policy)).toBe(false);
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
    });

    it("trims and lowercases allow entries", () => {
      const policy = resolveForwardHeadersPolicy({
        allow: ["  X-Tenant-Id  "],
      });
      expect(shouldForwardHeader("x-tenant-id", policy)).toBe(true);
      expect(shouldForwardHeader("authorization", policy)).toBe(false);
    });
  });

  describe("extractForwardableHeaders — default policy", () => {
    it("extracts only forwardable headers, dropping denylisted x-* infra", () => {
      const request = new Request("https://example.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Custom": "custom-value",
          // Denylisted by default — must NOT appear in the result.
          "X-Request-ID": "req-123",
          "X-Forwarded-For": "203.0.113.7",
          "X-Vercel-Id": "iad1::abc",
          Authorization: "Bearer token",
          Origin: "http://localhost",
        },
      });

      const result = extractForwardableHeaders(request, defaultPolicy);

      // The old expected object included `x-request-id`; under the default
      // policy that entry INVERTS out, leaving the custom + auth headers.
      expect(result).toEqual({
        "x-custom": "custom-value",
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

      const result = extractForwardableHeaders(request, defaultPolicy);

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

      const result = extractForwardableHeaders(request, defaultPolicy);

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

      const merged = mergeForwardableHeaders(
        serverHeaders,
        noForwardRequest(),
        defaultPolicy,
      );

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

      const merged = mergeForwardableHeaders(
        serverHeaders,
        noForwardRequest(),
        defaultPolicy,
      );

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
        headers: { "X-Tenant-Id": "tenant-123" },
      });

      const merged = mergeForwardableHeaders(
        serverHeaders,
        request,
        defaultPolicy,
      );

      expect(authKeys(merged)).toHaveLength(1);
      expect(merged["x-tenant-id"]).toBe("tenant-123");
    });
  });

  describe("mergeForwardableHeaders — breadth + precedence interaction (#5712)", () => {
    it("server-configured Authorization still wins over inbound authorization", () => {
      const serverHeaders: Record<string, string> = {
        Authorization: "Bearer SERVER-TOKEN",
      };
      const request = new Request("https://example.com/api/copilotkit", {
        method: "POST",
        headers: { Authorization: "Bearer INBOUND-TOKEN" },
      });

      const merged = mergeForwardableHeaders(
        serverHeaders,
        request,
        defaultPolicy,
      );

      expect(authKeys(merged)).toHaveLength(1);
      expect(merged["Authorization"]).toBe("Bearer SERVER-TOKEN");
    });

    it("server Authorization wins over inbound lowercase authorization with a DIFFERENT value (case-insensitive #5712)", () => {
      // The core #5712 scenario at the lowest layer: the server configured the
      // canonical-cased `Authorization`, the inbound request sends the
      // lowercased `authorization` (as the `Headers` iterator yields it) with a
      // DIFFERENT value. Exactly one authorization-family key may survive, and
      // it must carry the SERVER value — the inbound token must not win, and the
      // two case-variants must not both survive (which undici would comma-join
      // into an invalid "multiple JWTs" value).
      const serverHeaders: Record<string, string> = {
        Authorization: "Bearer SERVER-TOKEN",
      };
      const request = new Request("https://example.com/api/copilotkit", {
        method: "POST",
        headers: { authorization: "Bearer INBOUND-TOKEN" },
      });

      const merged = mergeForwardableHeaders(
        serverHeaders,
        request,
        defaultPolicy,
      );

      // Exactly one authorization-family key, carrying the SERVER value under
      // the server's original (canonical) casing.
      expect(authKeys(merged)).toHaveLength(1);
      const key = authKeys(merged)[0];
      expect(key).toBe("Authorization");
      expect(merged[key]).toBe("Bearer SERVER-TOKEN");
      // Belt-and-suspenders: the inbound value never appears anywhere.
      expect(Object.values(merged)).not.toContain("Bearer INBOUND-TOKEN");
    });

    it("a denylisted header never reaches the merge, so it cannot collide with a server header", () => {
      const serverHeaders: Record<string, string> = {
        "X-Forwarded-For": "server-set-value",
      };
      const request = new Request("https://example.com/api/copilotkit", {
        method: "POST",
        headers: { "X-Forwarded-For": "203.0.113.7" },
      });

      const merged = mergeForwardableHeaders(
        serverHeaders,
        request,
        defaultPolicy,
      );

      // The inbound x-forwarded-for is stripped by the denylist before merge,
      // so only the server-configured entry survives (no comma-join collision).
      const xffKeys = Object.keys(merged).filter(
        (k) => k.toLowerCase() === "x-forwarded-for",
      );
      expect(xffKeys).toHaveLength(1);
      expect(merged[xffKeys[0]]).toBe("server-set-value");
    });
  });
});
