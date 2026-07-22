import { describe, expect, it } from "vitest";

import {
  ProxyPolicyError,
  buildRuntimeIndex,
  resolveProxyTarget,
} from "./proxy-policy.js";
import type {
  RuntimeCatalogInput,
  RuntimeRegistryInput,
} from "./proxy-policy.js";

const registry: RuntimeRegistryInput = {
  integrations: [
    {
      slug: "langgraph-python",
      demos: [
        {
          id: "agentic-chat",
          route: "/demos/agentic-chat",
          runtime_path: "/api/copilotkit",
          highlight: ["src/app/api/copilotkit-mcp-apps/route.ts"],
        },
        {
          id: "mcp-apps",
          route: "/demos/mcp-apps",
          runtime_path: "/api/copilotkit-mcp-apps",
          highlight: ["src/app/api/copilotkit/route.ts"],
        },
      ],
    },
  ],
};

const catalog: RuntimeCatalogInput = {
  cells: [
    {
      id: "angular/langgraph-python/agentic-chat",
      frontend: "angular",
      integration: "langgraph-python",
      feature: "agentic-chat",
      runnable: true,
    },
    {
      id: "angular/langgraph-python/mcp-apps",
      frontend: "angular",
      integration: "langgraph-python",
      feature: "mcp-apps",
      runnable: true,
    },
    {
      id: "angular/langgraph-python/declarative-json-render",
      frontend: "angular",
      integration: "langgraph-python",
      feature: "declarative-json-render",
      runnable: false,
    },
  ],
};

const index = buildRuntimeIndex(registry, catalog);

function resolve(
  overrides: Partial<Parameters<typeof resolveProxyTarget>[0]> = {},
) {
  return resolveProxyTarget({
    index,
    integration: "langgraph-python",
    feature: "agentic-chat",
    suffix: "/agent/default/run",
    method: "POST",
    backendHostPattern: "showcase-{slug}.example.test",
    production: true,
    ...overrides,
  });
}

describe("Angular Showcase proxy policy", () => {
  it("derives the backend origin and explicit manifest runtime path", () => {
    expect(resolve()).toEqual({
      cellId: "angular/langgraph-python/agentic-chat",
      targetUrl:
        "https://showcase-langgraph-python.example.test/api/copilotkit/agent/default/run",
    });
    expect(
      resolve({ feature: "mcp-apps", suffix: "/info", method: "GET" }),
    ).toEqual({
      cellId: "angular/langgraph-python/mcp-apps",
      targetUrl:
        "https://showcase-langgraph-python.example.test/api/copilotkit-mcp-apps/info",
    });
  });

  it("rejects unknown and non-runnable cells", () => {
    expect(() => resolve({ integration: "unknown" })).toThrowError(
      new ProxyPolicyError("unknown-cell", 404),
    );
    expect(() => resolve({ feature: "declarative-json-render" })).toThrowError(
      new ProxyPolicyError("non-runnable-cell", 404),
    );
  });

  it("rejects arbitrary URLs, unknown paths, traversal, and query injection", () => {
    for (const suffix of [
      "https://attacker.example/steal",
      "/unknown/path",
      "/agent/default/run?destination=https://attacker.example",
      "/agent/../run",
      "/agent/%2e%2e/run",
      "/agent/default/run%2fextra",
    ]) {
      expect(() => resolve({ suffix }), suffix).toThrowError(ProxyPolicyError);
    }
  });

  it("enforces the HTTP method for each allowlisted runtime path", () => {
    expect(() => resolve({ suffix: "/info", method: "POST" })).toThrowError(
      new ProxyPolicyError("method-not-allowed", 405),
    );
    expect(() =>
      resolve({ suffix: "/agent/default/run", method: "GET" }),
    ).toThrowError(new ProxyPolicyError("method-not-allowed", 405));
  });

  it("rejects missing placeholders, schemes, credentials, and loopback in production", () => {
    for (const backendHostPattern of [
      "one-backend.example.test",
      "https://showcase-{slug}.example.test",
      "user:secret@showcase-{slug}.example.test",
      "localhost:3001/{slug}",
      "127.0.0.1:3001-{slug}",
    ]) {
      expect(
        () => resolve({ backendHostPattern }),
        backendHostPattern,
      ).toThrowError(new ProxyPolicyError("invalid-backend-config", 503));
    }
  });

  it("allows an explicit loopback pattern only outside production", () => {
    expect(
      resolve({
        backendHostPattern: "localhost:3001/{slug}",
        production: false,
      }).targetUrl,
    ).toBe(
      "http://localhost:3001/langgraph-python/api/copilotkit/agent/default/run",
    );
  });
});
