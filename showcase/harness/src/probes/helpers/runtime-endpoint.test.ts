/**
 * Unit tests for the SHARED CopilotKit-runtime-request predicate.
 *
 * The bug this locks down: probes recognised the runtime request by the
 * literal `/api/copilotkit` segment only. A `demo_frontend: unified`
 * integration serves its runtime at `/api/<slug>/<demo>`, so every probe that
 * consulted the SSE conjunct or captured the request body produced a FALSE RED
 * against a migrated integration (`reason=sse-missing`, `runsFinished=0`,
 * `captured body: (none)`) while the agent had demonstrably run.
 *
 * The tests are split into three groups on purpose:
 *   1. MUST MATCH — both live URL families, so a migrated and an unmigrated
 *      integration are both recognised by the SAME probe (iron rule 1).
 *   2. MUST NOT MATCH — what the widened shape deliberately excludes. This is
 *      the half that keeps currently-green cells green: over-matching would let
 *      a non-runtime request win the interceptor's single tracking slot.
 *   3. Method gate — the conjunct that makes the widened two-segment shape
 *      safe, plus its absent-method fallback.
 */
import { describe, it, expect } from "vitest";
import {
  COPILOTKIT_RUNTIME_URL_PATTERN,
  isCopilotkitRuntimeRequest,
  isRuntimeCapableMethod,
} from "./runtime-endpoint.js";

describe("COPILOTKIT_RUNTIME_URL_PATTERN — shapes that MUST match", () => {
  const matching = [
    // ── per-integration frontend (`demo_frontend: integration`) ──
    "/api/copilotkit",
    "http://langgraph-python:10000/api/copilotkit",
    "/api/copilotkit?x=1",
    "/api/copilotkit/info",
    "/api/copilotkit/agent/default/run",
    "/api/copilotkit-headless-complete",
    "/api/copilotkit-a2ui-fixed-schema",
    "/api/copilotkit-voice/transcribe",
    "http://frontend-nextjs:3000/api/copilotkit-mcp-apps/agent/x/run",
    // ── unified frontend (`demo_frontend: unified`) ──
    // The three cells that regressed on the langgraph-python migration:
    "/api/langgraph-python/headless-simple",
    "/api/langgraph-python/headless-complete",
    "/api/langgraph-python/readonly-state-agent-context",
    "http://frontend-nextjs:3000/api/langgraph-python/headless-simple",
    "/api/langgraph-python/headless-simple?x=1",
    "/api/langgraph-python/agentic-chat/agent/default/run",
    // Other slug shapes in the roster — hyphens in BOTH segments.
    "/api/built-in-agent/tool-rendering-default-catchall",
    "/api/strands-typescript/shared-state-read-write",
    // The two sibling routes that are code, not data — same shape, no special
    // case needed.
    "/api/langgraph-python/auth",
    "/api/langgraph-python/voice/transcribe",
  ];
  for (const url of matching) {
    it(`matches ${url}`, () => {
      expect(COPILOTKIT_RUNTIME_URL_PATTERN.test(url)).toBe(true);
      expect(isCopilotkitRuntimeRequest(url, "POST")).toBe(true);
    });
  }
});

describe("COPILOTKIT_RUNTIME_URL_PATTERN — shapes that MUST NOT match", () => {
  const rejected = [
    // The ONLY non-runtime `/api` routes the showcase frontends declare are
    // one-segment. Widening far enough to swallow these would let them win the
    // interceptor's single tracking slot ahead of the real runtime stream.
    "/api/health",
    "http://frontend-nextjs:3000/api/health",
    "/api/smoke",
    "/api/debug",
    // `copilotkit`-adjacent single segments — the behaviour the previous
    // pattern documented, preserved.
    "/api/copilotkitfoo",
    "/api/copilotkit_underscore_suffix",
    // Segments carrying characters outside lowercase-kebab. Integration slugs
    // and demo ids are lowercase-kebab by construction, so excluding these
    // costs nothing and drops a class of infrastructure paths — notably the
    // cvdiag PocketBase collection path.
    "http://pocketbase:8090/api/collections/cvdiag_events/records",
    "/api/_next/data/build/x.json",
    "/api/Foo/Bar",
    // Not under `/api` at all.
    "/langgraph-python/demos/headless-simple",
    "/_next/static/chunks/main.js",
    "",
  ];
  for (const url of rejected) {
    it(`rejects ${url || "(empty string)"}`, () => {
      expect(COPILOTKIT_RUNTIME_URL_PATTERN.test(url)).toBe(false);
      expect(isCopilotkitRuntimeRequest(url, "POST")).toBe(false);
    });
  }
});

describe("method gate", () => {
  it("rejects the safe verbs that can never carry a runtime run", () => {
    for (const m of ["GET", "get", "HEAD", "OPTIONS"]) {
      expect(isRuntimeCapableMethod(m)).toBe(false);
      expect(isCopilotkitRuntimeRequest("/api/copilotkit", m)).toBe(false);
      expect(
        isCopilotkitRuntimeRequest("/api/langgraph-python/headless-simple", m),
      ).toBe(false);
    }
  });

  it("accepts POST", () => {
    expect(isRuntimeCapableMethod("POST")).toBe(true);
    expect(isRuntimeCapableMethod("post")).toBe(true);
  });

  it("treats an ABSENT method as matchable — a dropped runtime request is a false red", () => {
    for (const m of [undefined, null, ""]) {
      expect(isRuntimeCapableMethod(m)).toBe(true);
      expect(
        isCopilotkitRuntimeRequest("/api/langgraph-python/headless-simple", m),
      ).toBe(true);
    }
  });

  it("does not let a matchable method rescue a non-runtime URL", () => {
    expect(isCopilotkitRuntimeRequest("/api/health", "POST")).toBe(false);
    expect(isCopilotkitRuntimeRequest("/api/health", undefined)).toBe(false);
  });
});

describe("iron rule 1 — no per-integration knowledge in the predicate", () => {
  it("recognises an integration slug it has never heard of", () => {
    // The predicate must never carry a slug list. A brand-new integration's
    // unified runtime URL has to match on SHAPE alone, with no probe edit.
    expect(
      isCopilotkitRuntimeRequest(
        "/api/some-integration-invented-tomorrow/agentic-chat",
        "POST",
      ),
    ).toBe(true);
  });

  it("has no integration slug or demo id baked into its source", () => {
    const src = COPILOTKIT_RUNTIME_URL_PATTERN.source;
    for (const slug of [
      "langgraph",
      "mastra",
      "agno",
      "strands",
      "crewai",
      "headless",
      "agentic",
    ]) {
      expect(src).not.toContain(slug);
    }
  });
});
