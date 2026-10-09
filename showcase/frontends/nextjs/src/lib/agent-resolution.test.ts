import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AGENT_KINDS,
  isAgentKind,
  integrationAgentUrlEnvVar,
  interpolateEnvPlaceholders,
  interpolateString,
  joinAgentUrl,
  ManifestCycleError,
  mergeAgentConfig,
  mergeRuntimeOptions,
  needsSyntheticReasoning,
  resolveAgentBaseUrl,
  resolveAgentName,
  resolveAgentTarget,
  resolveDemoOptions,
  resolveDemoRequest,
} from "@/lib/agent-resolution";
import type {
  AgentIntegrationManifest,
  AgentManifestDemo,
  EnvRecord,
} from "@/lib/agent-resolution";
import {
  AGENT_KEYS,
  DEMO_KEYS,
  getIntegration,
  listIntegrations,
  MANIFEST_KEYS,
} from "@/lib/integration-support";

describe("integrationAgentUrlEnvVar", () => {
  it("upper-snakes the slug", () => {
    expect(integrationAgentUrlEnvVar("langgraph-python")).toBe(
      "AGENT_URL_LANGGRAPH_PYTHON",
    );
    expect(integrationAgentUrlEnvVar("ag2")).toBe("AGENT_URL_AG2");
    expect(integrationAgentUrlEnvVar("ms-agent-harness-dotnet")).toBe(
      "AGENT_URL_MS_AGENT_HARNESS_DOTNET",
    );
  });
});

describe("resolveAgentBaseUrl", () => {
  it("reads only the namespaced variable", () => {
    const env: EnvRecord = { AGENT_URL_STRANDS: "http://strands:8000" };
    expect(resolveAgentBaseUrl("strands", env)).toBe("http://strands:8000");
  });

  it("ignores the historical unnamespaced names entirely", () => {
    // `agent_url_env` is a historical annotation. If it ever drives
    // resolution again, langgraph-fastapi breaks: its own routes read BOTH
    // AGENT_URL and LANGGRAPH_DEPLOYMENT_URL and one field cannot say both.
    const env: EnvRecord = {
      AGENT_URL: "http://wrong:1",
      LANGGRAPH_DEPLOYMENT_URL: "http://also-wrong:2",
    };
    expect(resolveAgentBaseUrl("langgraph-fastapi", env)).toBeNull();
  });
});

describe("joinAgentUrl", () => {
  it("appends exactly one trailing slash when there is no path", () => {
    // A slashless POST to a FastAPI / Spring / ASP.NET mount answers 307,
    // and a 307 drops the POST body, so the demo hangs instead of failing.
    expect(joinAgentUrl("http://strands:8000")).toBe("http://strands:8000/");
  });

  it("concatenates a path verbatim, without normalising", () => {
    expect(joinAgentUrl("http://agno:8000", "/subagents/agui")).toBe(
      "http://agno:8000/subagents/agui",
    );
    // The PATH is never rewritten — `//` inside it survives, because the
    // manifest is the authority on how a mount is spelled.
    expect(joinAgentUrl("http://x:1", "//y")).toBe("http://x:1//y");
  });

  it("strips exactly one trailing slash from the BASE", () => {
    // Every AGENT_URL_* is operator-supplied and a trailing slash is the
    // commonest way to write a base URL. Unnormalised it produces `//` —
    // a 404, or a body-dropping redirect.
    expect(joinAgentUrl("http://ag2:8000/")).toBe("http://ag2:8000/");
    expect(joinAgentUrl("http://ag2:8000/", "/agent-config")).toBe(
      "http://ag2:8000/agent-config",
    );
    // One slash, not all of them: a deliberate `//` base still says `//`.
    expect(joinAgentUrl("http://ag2:8000//", "/x")).toBe("http://ag2:8000//x");
  });
});

describe("mergeRuntimeOptions", () => {
  it("keeps sibling keys inside an option group when only one is overridden", () => {
    // The load-bearing case. A shallow spread drops `defaultCatalogId` and
    // the page renders "Catalog not found" — an error that reads like a
    // model problem and costs a day to trace.
    const defaults = {
      a2ui: {
        injectA2UITool: true,
        defaultCatalogId: "copilotkit://app-dashboard-catalog",
      },
    };
    const override = { a2ui: { injectA2UITool: false } };

    expect(mergeRuntimeOptions(defaults, override)).toEqual({
      a2ui: {
        injectA2UITool: false,
        defaultCatalogId: "copilotkit://app-dashboard-catalog",
      },
    });
  });

  it("stops merging at level 2 — a value inside a group replaces wholesale", () => {
    const merged = mergeRuntimeOptions(
      {
        mcpApps: { servers: [{ serverId: "a" }], other: { keep: 1, drop: 2 } },
      },
      { mcpApps: { other: { keep: 9 } } },
    );
    expect(merged).toEqual({
      mcpApps: { servers: [{ serverId: "a" }], other: { keep: 9 } },
    });
  });

  it("replaces arrays, never concatenates", () => {
    const merged = mergeRuntimeOptions(
      { openGenerativeUI: { agents: ["open-gen-ui", "open-gen-ui-advanced"] } },
      { openGenerativeUI: { agents: ["beautiful-chat"] } },
    );
    expect(merged).toEqual({
      openGenerativeUI: { agents: ["beautiful-chat"] },
    });
  });

  it("replaces when the types differ across levels", () => {
    expect(
      mergeRuntimeOptions(
        { openGenerativeUI: { agents: ["a"] } },
        { openGenerativeUI: true },
      ),
    ).toEqual({ openGenerativeUI: true });
    expect(
      mergeRuntimeOptions(
        { openGenerativeUI: true },
        { openGenerativeUI: { agents: ["a"] } },
      ),
    ).toEqual({ openGenerativeUI: { agents: ["a"] } });
  });

  it("tolerates absent sides", () => {
    expect(mergeRuntimeOptions(undefined, undefined)).toEqual({});
    expect(mergeRuntimeOptions({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeRuntimeOptions(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it("does not mutate its inputs", () => {
    const defaults = { a2ui: { injectA2UITool: true, defaultCatalogId: "c" } };
    mergeRuntimeOptions(defaults, { a2ui: { injectA2UITool: false } });
    expect(defaults).toEqual({
      a2ui: { injectA2UITool: true, defaultCatalogId: "c" },
    });
  });

  it("ALIASES a base group the override never mentions", () => {
    // Pinning a real coupling, not endorsing it. The level-1 copy is
    // shallow, so this group is still the module-level constant shared by
    // every demo that uses that default. Mutating it in place would change
    // what a second demo is served — which is why demo-runtime-options.ts
    // deep-freezes those constants.
    const base = { mcpApps: { servers: [{ serverId: "a" }] } };
    const merged = mergeRuntimeOptions(base, { openGenerativeUI: true });
    expect(merged.mcpApps).toBe(base.mcpApps);
  });

  it("treats a __proto__ key as a key, never as a setter", () => {
    // Manifest YAML supplies these keys. `merged[key] = …` would invoke the
    // inherited setter: the key vanishes and the prototype is replaced.
    const merged = mergeRuntimeOptions(
      {},
      JSON.parse('{"__proto__": {"polluted": true}}') as Record<
        string,
        unknown
      >,
    );
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  it("does not read an override target off the prototype chain", () => {
    // `merged["toString"]` is a function, not a plain object, so the merge
    // must replace rather than try to spread the inherited value.
    expect(mergeRuntimeOptions({}, { toString: { nested: 1 } })).toEqual({
      toString: { nested: 1 },
    });
  });
});

describe("interpolateString", () => {
  it("expands ${VAR}", () => {
    expect(interpolateString("${HOST}/x", { HOST: "http://a" })).toBe(
      "http://a/x",
    );
  });

  it("expands ${VAR:-default} to the env value when set", () => {
    expect(
      interpolateString("${MCP_SERVER_URL:-https://mcp.excalidraw.com}", {
        MCP_SERVER_URL: "http://local-mcp:9000",
      }),
    ).toBe("http://local-mcp:9000");
  });

  it("expands ${VAR:-default} to the default when unset or empty", () => {
    expect(
      interpolateString("${MCP_SERVER_URL:-https://mcp.excalidraw.com}", {}),
    ).toBe("https://mcp.excalidraw.com");
    expect(
      interpolateString("${MCP_SERVER_URL:-https://mcp.excalidraw.com}", {
        MCP_SERVER_URL: "",
      }),
    ).toBe("https://mcp.excalidraw.com");
  });

  it("expands a bare ${VAR} with no default to an empty string AND reports it", () => {
    // The expansion is unchanged, but the name is collected. An unset
    // credential that expands to "" otherwise surfaces as a provider 401
    // several layers down, naming nothing.
    const unresolved = new Set<string>();
    expect(interpolateString("a${NOPE}b", {}, unresolved)).toBe("ab");
    expect([...unresolved]).toEqual(["NOPE"]);
  });

  it("EMPTY IS A VALUE for a bare ${VAR} — set-but-empty is not drift", () => {
    // Several frameworks disable a feature by setting its variable empty.
    // That is a deliberate value, so it expands and reports nothing.
    const unresolved = new Set<string>();
    expect(interpolateString("[${FLAG}]", { FLAG: "" }, unresolved)).toBe("[]");
    expect([...unresolved]).toEqual([]);
  });

  it("distinguishes ${VAR-d} from ${VAR:-d}, exactly as sh does", () => {
    // `:-` means "unset OR empty" (what every manifest writes today).
    expect(interpolateString("${V:-d}", { V: "" })).toBe("d");
    // `-` means "unset ONLY", so an empty value survives. This is the form
    // to write when empty is a deliberate value.
    expect(interpolateString("${V-d}", { V: "" })).toBe("");
    expect(interpolateString("${V-d}", {})).toBe("d");
    // An empty default is a default, not an omission: neither form reports.
    const unresolved = new Set<string>();
    expect(interpolateString("${V:-}", {}, unresolved)).toBe("");
    expect([...unresolved]).toEqual([]);
  });

  it("does not resolve a placeholder off the prototype chain", () => {
    // `env["constructor"]` is a function; an unguarded index would splice
    // "function Object() { [native code] }" into an option value.
    const unresolved = new Set<string>();
    expect(interpolateString("${constructor}", {}, unresolved)).toBe("");
    expect([...unresolved]).toEqual(["constructor"]);
    expect(interpolateString("${toString:-fallback}", {})).toBe("fallback");
  });

  it("expands several placeholders in one string and leaves other text alone", () => {
    expect(interpolateString("${A}-${B:-two}-plain", { A: "one" })).toBe(
      "one-two-plain",
    );
  });

  it("pins the documented limit: a NESTED placeholder is not supported", () => {
    // `([^}]*)` cannot span the inner `}`, so the match ends at `${A:-${B}`
    // and the default expands to the LITERAL text `${B}` — with `B` never
    // collected as unresolved. No manifest uses the form, and the docstring
    // says so; this test is what makes the claim checkable, so anyone who
    // teaches the regex to balance braces sees this fail rather than shipping
    // a second, silently different expander.
    const unresolved = new Set<string>();
    expect(interpolateString("${A:-${B}}", {}, unresolved)).toBe("${B}");
    expect([...unresolved]).toEqual([]);
  });
});

describe("interpolateEnvPlaceholders", () => {
  it("walks nested objects and arrays", () => {
    const value = {
      mcpApps: {
        servers: [
          {
            type: "http",
            url: "${MCP_SERVER_URL:-https://mcp.excalidraw.com}",
            serverId: "excalidraw",
          },
        ],
      },
      openGenerativeUI: true,
      count: 25,
    };
    expect(interpolateEnvPlaceholders(value, {})).toEqual({
      mcpApps: {
        servers: [
          {
            type: "http",
            url: "https://mcp.excalidraw.com",
            serverId: "excalidraw",
          },
        ],
      },
      openGenerativeUI: true,
      count: 25,
    });
  });

  it("leaves non-string leaves untouched", () => {
    expect(interpolateEnvPlaceholders({ a: null, b: false, c: 0 }, {})).toEqual(
      {
        a: null,
        b: false,
        c: 0,
      },
    );
  });

  it("collects every unresolved name in the tree, however deep", () => {
    const unresolved = new Set<string>();
    interpolateEnvPlaceholders(
      {
        headers: [{ auth: "Bearer ${OPENAI_API_KEY}" }],
        url: "${HOST:-http://d}/${TENANT}",
      },
      {},
      unresolved,
    );
    expect([...unresolved].sort()).toEqual(["OPENAI_API_KEY", "TENANT"]);
  });

  it("treats a __proto__ key as a key, never as a setter", () => {
    const walked = interpolateEnvPlaceholders(
      JSON.parse('{"__proto__": {"polluted": "${X:-yes}"}}') as Record<
        string,
        unknown
      >,
      {},
    );
    expect(Object.hasOwn(walked, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(walked)).toBe(Object.prototype);
  });

  it("names a self-referencing value instead of overflowing the stack", () => {
    // REACHABLE FROM YAML, verified against the `yaml` package this app parses
    // manifests with: `a: &x\n  self: *x` resolves the alias into a real
    // reference, so `a.self === a`. The walk used to recurse until the stack
    // overflowed, and the caller answered the `RangeError` as
    // "manifest_load_failed" — a code that names loading, not the structure.
    const cyclic: Record<string, unknown> = { name: "${X:-ok}" };
    cyclic.self = cyclic;

    expect(() => interpolateEnvPlaceholders({ a: cyclic }, {})).toThrow(
      ManifestCycleError,
    );
    // The PATH is the whole value of the message: a manifest author has to find
    // which anchor closed the loop.
    expect(() => interpolateEnvPlaceholders({ a: cyclic }, {})).toThrow(
      "<root>.a.self",
    );
  });

  it("detects a cycle that closes through an ARRAY", () => {
    const items: unknown[] = [];
    items.push({ children: items });
    expect(() => interpolateEnvPlaceholders({ items }, {})).toThrow(
      ManifestCycleError,
    );
  });

  it("expands a REPEATED alias every time, rather than calling it a cycle", () => {
    // The ordinary, legitimate use of `&anchor` / `*alias`: one shared block
    // referenced from several places. It is a DAG, not a cycle, so the guard
    // must track ancestors only — a "seen anywhere" set would reject this.
    const shared = { key: "${OPENAI_API_KEY:-fallback}" };
    const walked = interpolateEnvPlaceholders(
      { first: shared, second: shared, nested: { third: shared } },
      {},
    ) as Record<string, Record<string, unknown>>;

    expect(walked.first.key).toBe("fallback");
    expect(walked.second.key).toBe("fallback");
    expect(walked.nested.third).toEqual({ key: "fallback" });
    // Rebuilt, so the shared source object is never handed on by reference.
    expect(walked.first).not.toBe(shared);
    expect(walked.first).not.toBe(walked.second);
  });
});

describe("mergeAgentConfig", () => {
  it("lets the demo override the integration-wide default", () => {
    // `recursion_limit` is LangGraph's per-run limit, delivered through
    // LangGraphAgent.assistantConfig. It is not a CopilotRuntime option,
    // so it lives in agent config, never in `runtime`.
    expect(
      mergeAgentConfig({ recursion_limit: 100 }, { recursion_limit: 25 }),
    ).toEqual({
      recursion_limit: 25,
    });
  });

  it("keeps default keys the demo does not mention", () => {
    expect(
      mergeAgentConfig({ recursion_limit: 100, other: 1 }, { other: 2 }),
    ).toEqual({
      recursion_limit: 100,
      other: 2,
    });
  });

  it("tolerates absent sides and does not mutate its inputs", () => {
    const defaults = { recursion_limit: 100 };
    expect(mergeAgentConfig(undefined, undefined)).toEqual({});
    expect(mergeAgentConfig(defaults, undefined)).toEqual({
      recursion_limit: 100,
    });
    expect(mergeAgentConfig(undefined, { recursion_limit: 25 })).toEqual({
      recursion_limit: 25,
    });
    mergeAgentConfig(defaults, { recursion_limit: 25 });
    expect(defaults).toEqual({ recursion_limit: 100 });
  });
});

describe("resolveAgentName", () => {
  it("prefers the manifest override", () => {
    expect(
      resolveAgentName("agentic-chat", {
        id: "agentic-chat",
        name: "x",
        agent: { name: "agentic_chat" },
      }),
    ).toBe("agentic_chat");
  });

  it("falls back to the demo id", () => {
    expect(resolveAgentName("subagents", { id: "subagents", name: "x" })).toBe(
      "subagents",
    );
    expect(resolveAgentName("subagents", undefined)).toBe("subagents");
  });
});

/* ---------------------------------------------------------------------------
 * Real manifests. These assert the exact strings the separator conventions
 * produce, because that is precisely where a silent 404 hides.
 * ------------------------------------------------------------------------ */

function manifestFor(slug: string): AgentIntegrationManifest {
  const manifest = getIntegration(slug) as AgentIntegrationManifest | undefined;
  if (!manifest) throw new Error(`manifest not found for ${slug}`);
  return manifest;
}

function demoFor(slug: string, demoId: string): AgentManifestDemo | undefined {
  return manifestFor(slug).demos?.find((demo) => demo.id === demoId);
}

/*
 * DELETED: "real manifests are readable from the test process > finds all 20
 * integrations", which asserted `listIntegrations().length >= 20`.
 *
 * Its title claimed exactness the assertion did not have — a floor passes when
 * a 21st manifest silently stops loading — and it was strictly weaker than a
 * test that already exists: `integration-support.test.ts`, "real manifests on
 * disk > loads exactly the integration manifests that are on disk", compares
 * the loaded slugs to the directories on disk by EQUALITY. Two tests, one
 * covering a subset of the other, is one test plus a false sense of coverage.
 * Everything below reads real manifests through `manifestFor`, so a manifest
 * tree that stops loading still fails loudly here.
 */

describe("AGENT_KINDS", () => {
  /** showcase/shared/manifest.schema.json — the JSON Schema copy of the list. */
  const SCHEMA_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../shared/manifest.schema.json",
  );

  it("matches the agent_kind enum in manifest.schema.json", () => {
    /**
     * THE THIRD COPY, finally pinned.
     *
     * `agent_kind` exists as three independent lists: this module's
     * `AGENT_KINDS`, the `enum` in `showcase/shared/manifest.schema.json`, and
     * `showcase/scripts/lib/manifest.ts`. The scripts package pins its copy
     * against the schema (`showcase/scripts/lib/__tests__/manifest.test.ts`,
     * "AGENT_KINDS"), and its comment recorded THIS copy as unpinnable because
     * this app cannot import that package.
     *
     * It cannot import the package — but it can read the file. The schema is
     * plain JSON on disk, four directories up, and this suite already reaches
     * the manifest tree by relative path. So the drift that used to be checked
     * only by `isAgentKind` AT REQUEST TIME (i.e. discovered by a user, on a
     * cell that renders misconfigured) is a build-time failure now.
     *
     * Set equality, not order: nothing depends on the declaration order, and an
     * order-sensitive assertion would fail for a non-reason.
     */
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as {
      properties: { agent_kind: { enum: string[] } };
    };
    expect([...schema.properties.agent_kind.enum].sort()).toEqual(
      [...AGENT_KINDS].sort(),
    );
  });

  it("accepts exactly the schema enum through isAgentKind", () => {
    // The equality above compares two lists. This compares the list to the
    // RUNTIME GUARD the app actually resolves with, which is the thing a
    // manifest author's typo meets.
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as {
      properties: { agent_kind: { enum: string[] } };
    };
    for (const kind of schema.properties.agent_kind.enum) {
      expect(isAgentKind(kind), kind).toBe(true);
    }
  });
});

describe("manifest key sets", () => {
  /**
   * THE SAME DRIFT, THREE MORE COPIES.
   *
   * `AGENT_KINDS` above got pinned to the schema because a hand-maintained
   * mirror of a closed list rots. `integration-support.ts` carries three more
   * of exactly that shape — `MANIFEST_KEYS`, `DEMO_KEYS`, `AGENT_KEYS` — each
   * mirroring one of the three `additionalProperties: false` objects in
   * `showcase/shared/manifest.schema.json`, with nothing holding them together.
   *
   * They agree today. The reason to pin them anyway is the blast radius, which
   * is worse than the `agent_kind` case: `assertKnownKeys` throws
   * `ManifestLoadError` on ANY unknown key, and `listIntegrations()` propagates
   * it rather than skipping the offending manifest. So adding one field to the
   * schema plus one manifest, and forgetting the list here, does not degrade
   * one cell — it takes the WHOLE unified app down: every demo renders "Invalid
   * Showcase route" and every API route 500s. That is a build-time failure now.
   *
   * BOTH DIRECTIONS, via set equality:
   *   - a key in the schema but not here -> valid manifests get rejected
   *     (the app-down case above);
   *   - a key here but not in the schema -> this validator silently accepts a
   *     field the schema forbids, so the CI schema check and the runtime
   *     disagree about what a manifest may contain.
   * Order is not asserted; nothing depends on it.
   */
  const SCHEMA_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../shared/manifest.schema.json",
  );

  interface SchemaObject {
    additionalProperties?: boolean;
    properties: Record<string, unknown>;
  }
  interface ManifestSchema extends SchemaObject {
    properties: {
      demos: { items: SchemaObject & { properties: { agent: SchemaObject } } };
    } & Record<string, unknown>;
  }

  const schema = JSON.parse(
    readFileSync(SCHEMA_PATH, "utf8"),
  ) as ManifestSchema;

  const demoSchema = schema.properties.demos.items;
  const agentSchema = demoSchema.properties.agent;

  const cases: ReadonlyArray<{
    label: string;
    node: SchemaObject;
    keys: readonly string[];
  }> = [
    { label: "MANIFEST_KEYS / top level", node: schema, keys: MANIFEST_KEYS },
    { label: "DEMO_KEYS / demos[]", node: demoSchema, keys: DEMO_KEYS },
    {
      label: "AGENT_KEYS / demos[].agent",
      node: agentSchema,
      keys: AGENT_KEYS,
    },
  ];

  for (const { label, node, keys } of cases) {
    it(`${label} matches manifest.schema.json exactly`, () => {
      expect(Object.keys(node.properties).sort()).toEqual([...keys].sort());
    });

    it(`${label} mirrors a closed (additionalProperties: false) object`, () => {
      // If the schema ever OPENS one of these objects, the runtime list stops
      // being a mirror of a closed set and the equality above becomes a
      // meaningless assertion about an open-ended thing. Fail loudly then, so
      // whoever opens it revisits `assertKnownKeys` instead of leaving a test
      // that still passes while guarding nothing.
      expect(node.additionalProperties).toBe(false);
    });
  }
});

describe("resolveAgentTarget against real manifests", () => {
  it("strands agentic-chat: no path, so exactly one trailing slash", () => {
    const target = resolveAgentTarget(
      manifestFor("strands"),
      demoFor("strands", "agentic-chat"),
      { AGENT_URL_STRANDS: "http://strands:8000" },
    );
    expect(target).toEqual({ kind: "http", url: "http://strands:8000/" });
  });

  it("agno subagents: /subagents/agui", () => {
    const target = resolveAgentTarget(
      manifestFor("agno"),
      demoFor("agno", "subagents"),
      { AGENT_URL_AGNO: "http://agno:8000" },
    );
    expect(target).toEqual({
      kind: "http",
      url: "http://agno:8000/subagents/agui",
    });
  });

  it("spring-ai subagents: /subagents/run", () => {
    const target = resolveAgentTarget(
      manifestFor("spring-ai"),
      demoFor("spring-ai", "subagents"),
      { AGENT_URL_SPRING_AI: "http://spring-ai:8000" },
    );
    expect(target).toEqual({
      kind: "http",
      url: "http://spring-ai:8000/subagents/run",
    });
  });

  it("google-adk open-gen-ui: /open_gen_ui, snake_case, not rewritten", () => {
    const target = resolveAgentTarget(
      manifestFor("google-adk"),
      demoFor("google-adk", "open-gen-ui"),
      { AGENT_URL_GOOGLE_ADK: "http://google-adk:8000" },
    );
    expect(target).toEqual({
      kind: "http",
      url: "http://google-adk:8000/open_gen_ui",
    });
  });

  it("langgraph-fastapi a2ui-recovery: same graph id, agent config, and a2ui flags as langgraph-python", () => {
    const env = {
      AGENT_URL_LANGGRAPH_FASTAPI: "http://langgraph-fastapi:8123",
      AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123",
    };
    const fastapi = resolveDemoRequest(
      "langgraph-fastapi",
      "a2ui-recovery",
      env,
    );
    const lgp = resolveDemoRequest("langgraph-python", "a2ui-recovery", env);
    expect(fastapi.ok).toBe(true);
    expect(lgp.ok).toBe(true);
    if (!fastapi.ok || !lgp.ok) return;

    expect(fastapi.resolved.target).toEqual({
      kind: "langgraph",
      deploymentUrl: "http://langgraph-fastapi:8123",
      graphId: "a2ui_recovery",
    });
    expect(fastapi.resolved.agentConfig).toEqual({ recursion_limit: 25 });
    expect(fastapi.resolved.runtimeOptions.a2ui).toEqual({
      injectA2UITool: false,
      defaultCatalogId: "declarative-gen-ui-catalog",
    });
    expect(fastapi.resolved.agentConfig).toEqual(lgp.resolved.agentConfig);
    expect(fastapi.resolved.runtimeOptions.a2ui).toEqual(
      lgp.resolved.runtimeOptions.a2ui,
    );
  });

  it("crewai-conversational-flows agentic-chat dials /conversational_flows/chat", () => {
    const target = resolveAgentTarget(
      manifestFor("crewai-conversational-flows"),
      demoFor("crewai-conversational-flows", "agentic-chat"),
      {
        AGENT_URL_CREWAI_CONVERSATIONAL_FLOWS:
          "http://crewai-conversational-flows:8000",
      },
    );
    expect(target).toEqual({
      kind: "http",
      url: "http://crewai-conversational-flows:8000/conversational_flows/chat",
    });
  });

  it("crewai-conversational-flows shared-state-read dials its dedicated flow", () => {
    const target = resolveAgentTarget(
      manifestFor("crewai-conversational-flows"),
      demoFor("crewai-conversational-flows", "shared-state-read"),
      {
        AGENT_URL_CREWAI_CONVERSATIONAL_FLOWS:
          "http://crewai-conversational-flows:8000",
      },
    );
    expect(target).toEqual({
      kind: "http",
      url: "http://crewai-conversational-flows:8000/conversational_flows/shared-state-read",
    });
  });

  it("langgraph-python shared-state-read: graph shared_state_read, not sample_agent", () => {
    const target = resolveAgentTarget(
      manifestFor("langgraph-python"),
      demoFor("langgraph-python", "shared-state-read"),
      { AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123" },
    );
    expect(target).toEqual({
      kind: "langgraph",
      deploymentUrl: "http://langgraph-python:8123",
      graphId: "shared_state_read",
    });
  });

  it("shared-state-read page seeds recipe on [agent], not []", () => {
    // `useAgent` returns a provisional agent, then swaps in the runtime-synced
    // one. A `[]`-deps seed writes only to the throwaway instance, so the
    // card can show INITIAL_RECIPE while runAgent sends state: {}.
    const page = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../app/[integration]/demos/shared-state-read/page.tsx",
      ),
      "utf8",
    );
    expect(page).toMatch(/agent\.setState\(\{\s*recipe: INITIAL_RECIPE/);
    expect(page).toMatch(/\}, \[agent\]\);/);
    expect(page).not.toMatch(/\}, \[\]\);/);
  });

  it("langgraph-python declarative-gen-ui: graph a2ui_dynamic, deployment URL verbatim", () => {
    const target = resolveAgentTarget(
      manifestFor("langgraph-python"),
      demoFor("langgraph-python", "declarative-gen-ui"),
      { AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123" },
    );
    // No trailing slash: the LangGraph client owns its own path scheme.
    expect(target).toEqual({
      kind: "langgraph",
      deploymentUrl: "http://langgraph-python:8123",
      graphId: "a2ui_dynamic",
    });
  });

  it("built-in-agent is in-process and dials no URL", () => {
    expect(
      resolveAgentTarget(
        manifestFor("built-in-agent"),
        demoFor("built-in-agent", "agentic-chat"),
        {},
      ),
    ).toEqual({ kind: "in-process" });
  });

  it("reports the missing variable by name when the base URL is unset", () => {
    expect(resolveAgentTarget(manifestFor("strands"), undefined, {})).toEqual({
      kind: "unconfigured",
      envVar: "AGENT_URL_STRANDS",
    });
  });

  it("REJECTS agent.path on a langgraph integration instead of dropping it", () => {
    // The LangGraph client builds its own paths, so a path here has no
    // destination. Ignoring it silently leaves a manifest author reading a
    // line that does nothing.
    const target = resolveAgentTarget(
      manifestFor("langgraph-python"),
      { id: "agentic-chat", name: "x", agent: { path: "/agui" } },
      { AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123" },
    );
    expect(target.kind).toBe("misconfigured");
    expect(target.kind === "misconfigured" && target.message).toContain(
      "agent_kind: langgraph",
    );
  });

  it("REJECTS agent.path on an in-process integration too", () => {
    const target = resolveAgentTarget(
      manifestFor("built-in-agent"),
      { id: "agentic-chat", name: "x", agent: { path: "/agui" } },
      {},
    );
    expect(target.kind).toBe("misconfigured");
  });

  it("REJECTS an agent.path with no leading slash instead of dialling a mangled URL", () => {
    // `joinAgentUrl` concatenates VERBATIM, so `subagents/agui` produces
    // `http://strands:8000subagents/agui` — a URL that fails deep inside the
    // agent client instead of here, with a named reason. The JSON schema has
    // `"pattern": "^/"`, but the schema does not run at request time.
    const target = resolveAgentTarget(
      manifestFor("strands"),
      { id: "agentic-chat", name: "x", agent: { path: "subagents/agui" } },
      { AGENT_URL_STRANDS: "http://strands:8000" },
    );
    expect(target.kind).toBe("misconfigured");
    const message = target.kind === "misconfigured" ? target.message : "";
    expect(message).toContain("subagents/agui");
    expect(message).toContain('start with "/"');
  });

  it("REJECTS an EMPTY agent.path, which a truthiness test could not see", () => {
    // `path: ""` is a manifest line that does nothing. Under truthiness it was
    // indistinguishable from no path at all, so it silently became `<base>/` —
    // the integration's ROOT agent, which answers and streams plausible text.
    const target = resolveAgentTarget(
      manifestFor("strands"),
      { id: "agentic-chat", name: "x", agent: { path: "" } },
      { AGENT_URL_STRANDS: "http://strands:8000" },
    );
    expect(target.kind).toBe("misconfigured");

    // ...and on a kind that dials no sub-path at all it is caught earlier, by
    // the arm that names the kind.
    const onLanggraph = resolveAgentTarget(
      manifestFor("langgraph-python"),
      { id: "agentic-chat", name: "x", agent: { path: "" } },
      { AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123" },
    );
    expect(onLanggraph.kind).toBe("misconfigured");
    expect(
      onLanggraph.kind === "misconfigured" && onLanggraph.message,
    ).toContain("agent_kind: langgraph");
  });

  it("still accepts a path that does start with a slash", () => {
    expect(
      resolveAgentTarget(
        manifestFor("strands"),
        { id: "agentic-chat", name: "x", agent: { path: "/subagents/agui" } },
        { AGENT_URL_STRANDS: "http://strands:8000" },
      ),
    ).toEqual({ kind: "http", url: "http://strands:8000/subagents/agui" });
  });

  it("REJECTS an agent_kind outside the union instead of silently serving http", () => {
    // The typo that used to be invisible. `agent_kind` is YAML, so `langraph`
    // missed every `===` and fell through to the http arm — where a LangGraph
    // deployment's base URL answers on `/` and `agent.graph` is dropped.
    const target = resolveAgentTarget(
      { ...manifestFor("langgraph-python"), agent_kind: "langraph" },
      demoFor("langgraph-python", "declarative-gen-ui"),
      { AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123" },
    );
    expect(target.kind).toBe("misconfigured");
    const message = target.kind === "misconfigured" ? target.message : "";
    expect(message).toContain("langraph");
    // The message has to say what IS allowed, or the reader is left guessing.
    expect(message).toContain("http, langgraph, in-process");
  });

  it("accepts every kind in the union, and an absent agent_kind as http", () => {
    for (const kind of AGENT_KINDS) {
      const target = resolveAgentTarget(
        { ...manifestFor("strands"), agent_kind: kind },
        { id: "agentic-chat", name: "x" },
        { AGENT_URL_STRANDS: "http://strands:8000" },
      );
      expect(target.kind, kind).not.toBe("misconfigured");
    }

    // The second half of the title, which the loop above does NOT cover: the
    // loop only ever passes a kind that IS in the union, so nothing here used
    // to omit `agent_kind` at all. Omission is the commonest case on disk —
    // most manifests never write the field — and the resolver reaches it by a
    // different route (past the `!isAgentKind(declared)` guard, on the
    // `undefined` branch that means "http"). `delete` rather than
    // `agent_kind: undefined`, because an explicit undefined property is not
    // the same shape as an absent one for anything that enumerates keys.
    const absent = { ...manifestFor("strands") };
    delete absent.agent_kind;
    expect("agent_kind" in absent).toBe(false);
    expect(
      resolveAgentTarget(
        absent,
        { id: "agentic-chat", name: "x" },
        { AGENT_URL_STRANDS: "http://strands:8000" },
      ),
    ).toEqual({ kind: "http", url: "http://strands:8000/" });

    expect(isAgentKind("in-process")).toBe(true);
    expect(isAgentKind("langraph")).toBe(false);
    expect(isAgentKind(undefined)).toBe(false);
  });

  it("REJECTS agent.graph on an http integration instead of dropping it", () => {
    // Only the LangGraph client takes a graph id. Silently ignoring one here
    // is the same silent loss the agent.path arm above exists to prevent.
    const target = resolveAgentTarget(
      manifestFor("strands"),
      { id: "agentic-chat", name: "x", agent: { graph: "some_graph" } },
      { AGENT_URL_STRANDS: "http://strands:8000" },
    );
    expect(target.kind).toBe("misconfigured");
    const message = target.kind === "misconfigured" ? target.message : "";
    expect(message).toContain("agent.graph");
    expect(message).toContain("some_graph");
  });

  it("REJECTS agent.graph on an in-process integration too", () => {
    const target = resolveAgentTarget(
      manifestFor("built-in-agent"),
      { id: "agentic-chat", name: "x", agent: { graph: "some_graph" } },
      {},
    );
    expect(target.kind).toBe("misconfigured");
  });

  /**
   * `${VAR}` IN THE THREE STRINGS THIS RESOLVER DIALS.
   *
   * `resolveDemoOptions` has always expanded placeholders in `agentConfig` and
   * `runtimeOptions`, and collects unset bare `${VAR}` names so the caller can
   * fail the request loudly — "a bare ${OPENAI_API_KEY} travels all the way to
   * the provider and returns a 401 that names nothing". `resolveAgentTarget` did
   * none of it, so two adjacent fields on the SAME manifest row behaved in
   * opposite ways and nothing said so: `path: "/agents/${TENANT}/run"` sent the
   * literal `${` to the backend (a 404 from the agent framework) and
   * `graph: "${GRAPH_ID}"` produced a LangGraph "graph not found" — neither
   * naming the unexpanded variable.
   */
  describe("${VAR} expansion in the agent target", () => {
    it("expands a placeholder in agent.path", () => {
      expect(
        resolveAgentTarget(
          manifestFor("strands"),
          {
            id: "agentic-chat",
            name: "x",
            agent: { path: "/agents/${TENANT}/run" },
          },
          { AGENT_URL_STRANDS: "http://strands:8000", TENANT: "acme" },
        ),
      ).toEqual({ kind: "http", url: "http://strands:8000/agents/acme/run" });
    });

    it("expands a placeholder in agent.graph", () => {
      expect(
        resolveAgentTarget(
          manifestFor("langgraph-python"),
          { id: "agentic-chat", name: "x", agent: { graph: "${GRAPH_ID}" } },
          {
            AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123",
            GRAPH_ID: "a2ui_dynamic",
          },
        ),
      ).toEqual({
        kind: "langgraph",
        deploymentUrl: "http://langgraph-python:8123",
        graphId: "a2ui_dynamic",
      });
    });

    it("expands a placeholder in the agent BASE URL", () => {
      // The operator-supplied half, and the likeliest of the three to still hold
      // an unexpanded compose or Railway reference.
      expect(
        resolveAgentTarget(manifestFor("strands"), undefined, {
          AGENT_URL_STRANDS: "http://${AGENT_HOST}:8000",
          AGENT_HOST: "strands-staging",
        }),
      ).toEqual({ kind: "http", url: "http://strands-staging:8000/" });
    });

    it("honours ${VAR:-default} in all three, exactly as the option tracks do", () => {
      expect(
        resolveAgentTarget(
          manifestFor("strands"),
          {
            id: "x",
            name: "x",
            agent: { path: "${SUBPATH:-/subagents/agui}" },
          },
          { AGENT_URL_STRANDS: "http://${HOST:-strands}:8000" },
        ),
      ).toEqual({ kind: "http", url: "http://strands:8000/subagents/agui" });
    });

    it("COLLECTS an unset bare ${VAR} from each of the three into the shared report", () => {
      // The whole point: the name reaches the same `unresolvedPlaceholders`
      // report `resolveDemoOptions` feeds, so `validateResolved` in
      // demo-runtime.ts answers a 500 that NAMES the variable instead of the
      // backend answering a 404 about a URL containing a literal `${`.
      const unresolved = new Set<string>();
      resolveAgentTarget(
        manifestFor("strands"),
        { id: "x", name: "x", agent: { path: "/agents/${TENANT}/run" } },
        { AGENT_URL_STRANDS: "http://${AGENT_HOST}x:8000" },
        unresolved,
      );
      expect([...unresolved].sort()).toEqual(["AGENT_HOST", "TENANT"]);

      const graphUnresolved = new Set<string>();
      resolveAgentTarget(
        manifestFor("langgraph-python"),
        { id: "x", name: "x", agent: { graph: "${GRAPH_ID}" } },
        { AGENT_URL_LANGGRAPH_PYTHON: "http://lg:8123" },
        graphUnresolved,
      );
      expect([...graphUnresolved]).toEqual(["GRAPH_ID"]);
    });

    it("reports a base URL that expands to NOTHING as unconfigured, naming the variable", () => {
      // `AGENT_URL_STRANDS=${MISSING}` expands to `""`. Dialling `"/"` would be
      // the root-agent failure again; naming the variable is the honest answer.
      const target = resolveAgentTarget(manifestFor("strands"), undefined, {
        AGENT_URL_STRANDS: "${MISSING}",
      });
      expect(target).toEqual({
        kind: "unconfigured",
        envVar: "AGENT_URL_STRANDS",
      });
    });

    it("validates the EXPANDED path, not the raw one", () => {
      // The check that matters is on the string actually dialled. A raw
      // `${PREFIX}/x` does not start with "/" and would be rejected on its raw
      // form for no reason; expanded with `PREFIX=/api` it is a legal `/api/x`.
      expect(
        resolveAgentTarget(
          manifestFor("strands"),
          { id: "x", name: "x", agent: { path: "${PREFIX}/x" } },
          { AGENT_URL_STRANDS: "http://strands:8000", PREFIX: "/api" },
        ),
      ).toEqual({ kind: "http", url: "http://strands:8000/api/x" });

      // ...and the reverse: a placeholder that expands to a path with no
      // leading slash is still caught, by the arm that names the reason.
      const bad = resolveAgentTarget(
        manifestFor("strands"),
        { id: "x", name: "x", agent: { path: "${PREFIX}/x" } },
        { AGENT_URL_STRANDS: "http://strands:8000", PREFIX: "api" },
      );
      expect(bad.kind).toBe("misconfigured");
      expect(bad.kind === "misconfigured" && bad.message).toContain(
        'start with "/"',
      );
    });

    it("makes resolveDemoRequest fail the request instead of dialling a literal ${", () => {
      // End to end through the one funnel: an unset placeholder in `agent.path`
      // now lands in the SAME report an unset placeholder in `agent.config`
      // does, which is what `validateResolved` turns into a named 500.
      const result = resolveDemoRequest(
        "synthetic",
        "described-demo",
        { AGENT_URL_SYNTHETIC: "http://synthetic:8000" },
        [
          {
            name: "Synthetic",
            slug: "synthetic",
            features: ["described-demo"],
            agent_defaults: { token: "${LANGFUSE_TOKEN}" },
            demos: [
              {
                id: "described-demo",
                name: "Described",
                route: "/demos/described",
                agent: { path: "/agents/${TENANT}/run" },
              },
            ],
          } as AgentIntegrationManifest,
        ],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // BOTH tracks in one sorted report — the agent target's and the config's.
      expect(result.resolved.unresolvedPlaceholders).toEqual([
        "LANGFUSE_TOKEN",
        "TENANT",
      ]);
    });
  });

  it("still accepts agent.graph on the langgraph kind", () => {
    const target = resolveAgentTarget(
      manifestFor("langgraph-python"),
      { id: "agentic-chat", name: "x", agent: { graph: "agentic_chat" } },
      { AGENT_URL_LANGGRAPH_PYTHON: "http://langgraph-python:8123" },
    );
    expect(target).toEqual({
      kind: "langgraph",
      deploymentUrl: "http://langgraph-python:8123",
      graphId: "agentic_chat",
    });
  });
});

describe("needsSyntheticReasoning", () => {
  /**
   * THE SIGNAL, ASSERTED AGAINST THE REAL MANIFESTS.
   *
   * The shim must fire for the agents that cannot emit `REASONING_*` events and
   * for nothing else. Applied to a backend that DOES emit them, every reasoning
   * bubble is duplicated — so the negative cases below are as load-bearing as
   * the positive ones, and they are read off the manifest tree on disk rather
   * than off a fixture, because the field's whole job is to say which real
   * slugs are which.
   */
  const SHIMMED = ["ms-agent-dotnet", "ms-agent-harness-dotnet"];

  it("is true for exactly the three reasoning cells of the two .NET slugs", () => {
    for (const slug of SHIMMED) {
      const manifest = manifestFor(slug);
      expect(needsSyntheticReasoning(manifest, "reasoning-default"), slug).toBe(
        true,
      );
      expect(needsSyntheticReasoning(manifest, "reasoning-custom"), slug).toBe(
        true,
      );
      expect(
        needsSyntheticReasoning(manifest, "tool-rendering-reasoning-chain"),
        slug,
      ).toBe(true);
    }
  });

  it("is false for another demo on the SAME slug", () => {
    // Per-demo, not integration-wide: the same .NET backend serves
    // `tool-rendering-default-catchall`, whose spec the extra events break.
    for (const slug of SHIMMED) {
      expect(
        needsSyntheticReasoning(
          manifestFor(slug),
          "tool-rendering-default-catchall",
        ),
        slug,
      ).toBe(false);
      expect(
        needsSyntheticReasoning(manifestFor(slug), "agentic-chat"),
        slug,
      ).toBe(false);
    }
  });

  it("is false for every OTHER integration, including the reasoning cells", () => {
    // The population is deliberately closed. `mastra`, `langgraph-python` and
    // `ms-agent-python` all emit reasoning events natively, and `spring-ai`
    // emits real `REASONING_MESSAGE_*` frames from its own Java
    // ReasoningController — so listing any of them would double the events, not
    // add missing ones.
    const listed = listIntegrations()
      .filter((manifest) =>
        ["reasoning-default", "reasoning-custom"].some((demoId) =>
          needsSyntheticReasoning(manifest as AgentIntegrationManifest, demoId),
        ),
      )
      .map((manifest) => manifest.slug)
      .sort();

    expect(listed).toEqual([...SHIMMED].sort());
  });

  it("is false when the manifest declares no list at all", () => {
    expect(
      needsSyntheticReasoning(
        { name: "Synthetic", slug: "synthetic" },
        "reasoning-default",
      ),
    ).toBe(false);
  });

  it("reaches ResolvedDemo, so demo-runtime does not re-derive it", () => {
    const resolution = resolveDemoRequest(
      "ms-agent-dotnet",
      "reasoning-default",
      { AGENT_URL_MS_AGENT_DOTNET: "http://ms-agent-dotnet:8000" },
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.resolved.injectSyntheticReasoning).toBe(true);
    // And the agent it dials is the dedicated reasoning mount, not the root
    // agent — the shim only makes sense on top of the right backend.
    expect(resolution.resolved.target).toEqual({
      kind: "http",
      url: "http://ms-agent-dotnet:8000/reasoning",
    });
  });

  it("stays false on the resolution for a natively-capable slug", () => {
    const resolution = resolveDemoRequest("mastra", "reasoning-default", {
      AGENT_URL_MASTRA: "http://mastra:8000",
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.resolved.injectSyntheticReasoning).toBe(false);
  });
});

describe("resolveDemoOptions against real manifests", () => {
  it("langgraph-python beautiful-chat keeps the catalog id while flipping nothing it should not", () => {
    const { agentConfig, runtimeOptions } = resolveDemoOptions(
      "beautiful-chat",
      manifestFor("langgraph-python"),
      demoFor("langgraph-python", "beautiful-chat"),
      {},
    );
    // Demo-level 25 beats the integration-wide agent_defaults 100.
    expect(agentConfig).toEqual({ recursion_limit: 25 });
    // ...and it never leaks into the CopilotRuntime options.
    expect(runtimeOptions.recursion_limit).toBeUndefined();
    expect(runtimeOptions.a2ui).toEqual({
      injectA2UITool: true,
      defaultCatalogId: "copilotkit://app-dashboard-catalog",
    });
    expect(runtimeOptions.openGenerativeUI).toBe(true);
  });

  it("langgraph-python agentic-chat inherits the integration-wide recursion limit", () => {
    const { agentConfig, runtimeOptions } = resolveDemoOptions(
      "agentic-chat",
      manifestFor("langgraph-python"),
      demoFor("langgraph-python", "agentic-chat"),
      {},
    );
    expect(agentConfig).toEqual({ recursion_limit: 100 });
    expect(runtimeOptions).toEqual({});
  });

  it("resolves the same recursion limit for every langgraph demo as its manifest declares", () => {
    // The invariant the `runtime` -> `agent.config` move had to preserve:
    // 14 demos per integration are pinned to LangGraph's stock 25, the
    // rest inherit the integration-wide 100.
    for (const slug of ["langgraph-python", "langgraph-fastapi"]) {
      const manifest = manifestFor(slug);
      const pinned = (manifest.demos ?? []).filter(
        (demo) => demo.agent?.config?.recursion_limit === 25,
      );
      expect(pinned.length).toBe(14);
      for (const demo of manifest.demos ?? []) {
        const { agentConfig } = resolveDemoOptions(demo.id, manifest, demo, {});
        expect(agentConfig.recursion_limit).toBe(
          demo.agent?.config?.recursion_limit ?? 100,
        );
      }
    }
  });

  it("passes an unknown runtime key straight through to CopilotRuntime", () => {
    // No key filtering: `runtime` means CopilotRuntime options, all of
    // them. An option this app has never heard of must still arrive —
    // restoring that property is the whole point of moving
    // `recursion_limit` out of this block.
    const { agentConfig, runtimeOptions } = resolveDemoOptions(
      "agentic-chat",
      manifestFor("langgraph-python"),
      {
        id: "agentic-chat",
        name: "x",
        runtime: { someFutureRuntimeOption: { nested: true } },
      },
      {},
    );
    expect(runtimeOptions).toEqual({
      someFutureRuntimeOption: { nested: true },
    });
    expect(agentConfig).toEqual({ recursion_limit: 100 });
  });

  it("expands the MCP placeholder for a real mcp-apps demo", () => {
    const { runtimeOptions } = resolveDemoOptions(
      "mcp-apps",
      manifestFor("agno"),
      demoFor("agno", "mcp-apps"),
      {},
    );
    expect(runtimeOptions.mcpApps).toEqual({
      servers: [
        {
          type: "http",
          url: "https://mcp.excalidraw.com",
          serverId: "excalidraw",
        },
      ],
    });
  });

  it("supplies the shared open-gen-ui default even when a manifest omits it", () => {
    const { runtimeOptions } = resolveDemoOptions(
      "open-gen-ui",
      manifestFor("strands"),
      // Deliberately pass no demo: the shared default must still apply.
      undefined,
      {},
    );
    expect(runtimeOptions.openGenerativeUI).toEqual({
      agents: ["open-gen-ui", "open-gen-ui-advanced"],
    });
  });

  it("injects generate_a2ui for langgraph-python declarative-gen-ui", () => {
    // The unified runtime only attaches A2UI middleware when this flag is
    // on CopilotRuntime. The page catalog alone does not intercept the
    // Python generate_a2ui stub.
    const { runtimeOptions } = resolveDemoOptions(
      "declarative-gen-ui",
      manifestFor("langgraph-python"),
      demoFor("langgraph-python", "declarative-gen-ui"),
      {},
    );
    expect(runtimeOptions.a2ui).toEqual({ injectA2UITool: true });
  });

  it("ag2 beautiful-chat overrides openGenerativeUI with its own agent list", () => {
    const { runtimeOptions } = resolveDemoOptions(
      "beautiful-chat",
      manifestFor("ag2"),
      demoFor("ag2", "beautiful-chat"),
      {},
    );
    expect(runtimeOptions.openGenerativeUI).toEqual({
      agents: ["beautiful-chat"],
    });
  });

  it("reports unresolved bare placeholders from BOTH tracks, sorted", () => {
    const { unresolvedPlaceholders } = resolveDemoOptions(
      "agentic-chat",
      {
        ...manifestFor("strands"),
        agent_defaults: { token: "${LANGFUSE_TOKEN}" },
      },
      {
        id: "agentic-chat",
        name: "x",
        runtime: { key: "${OPENAI_API_KEY}", ok: "${SET_ONE}" },
      },
      { SET_ONE: "value" },
    );
    expect(unresolvedPlaceholders).toEqual([
      "LANGFUSE_TOKEN",
      "OPENAI_API_KEY",
    ]);
  });

  it("reports nothing for every real manifest — they all use ${VAR:-default}", () => {
    for (const manifest of listIntegrations()) {
      const typed = manifest as AgentIntegrationManifest;
      for (const demo of typed.demos ?? []) {
        expect(
          resolveDemoOptions(demo.id, typed, demo, {}).unresolvedPlaceholders,
          `${typed.slug}/${demo.id}`,
        ).toEqual([]);
      }
    }
  });

  it("does not pull a defaults table off the prototype chain", () => {
    // `DEMO_RUNTIME_OPTIONS["constructor"]` is `Object` — truthy, and the
    // merge would treat it as a table of shared defaults.
    const { runtimeOptions } = resolveDemoOptions(
      "constructor",
      manifestFor("strands"),
      undefined,
      {},
    );
    expect(runtimeOptions).toEqual({});
  });
});

/**
 * A SYNTHETIC manifest, deliberately not a real one.
 *
 * The drift rule below used to be asserted against agno's live
 * `shared-state-read` drift. The message that rule produces tells the author to
 * ADD the missing demos[] entry — so performing the repair the code recommends
 * turned the test red. A test that punishes its own advice is worse than no
 * test. Real drift belongs in a manifest lint that fails on its own terms.
 */
const SYNTHETIC_MANIFESTS: AgentIntegrationManifest[] = [
  {
    name: "Synthetic",
    slug: "synthetic",
    features: ["orphan-demo", "described-demo", "informational-demo"],
    demos: [
      { id: "described-demo", name: "Described", route: "/demos/described" },
      {
        id: "informational-demo",
        name: "Informational",
        command: "npx copilotkit@latest init --framework synthetic",
      },
    ],
  },
];

describe("resolveDemoRequest", () => {
  it("REFUSES a demo the manifest calls supported but never describes", () => {
    // Without an entry there is no agent.path, so the request would land on
    // `<base>/` — the integration's ROOT agent — which answers, streams, and
    // renders the wrong demo.
    const result = resolveDemoRequest(
      "synthetic",
      "orphan-demo",
      { AGENT_URL_SYNTHETIC: "http://synthetic:8000" },
      SYNTHETIC_MANIFESTS,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.support.reason).toMatch(/Manifest drift/);
    expect(!result.ok && result.support.reason).toContain("orphan-demo");
  });

  it("REFUSES an informational demo — no route and no agent means nothing to run", () => {
    // `cli-start` is the live case: a copy-paste shell command listed under
    // features. Served as an agent it produced advice about `agent.graph`,
    // which is nonsense for a command cell.
    const result = resolveDemoRequest(
      "synthetic",
      "informational-demo",
      { AGENT_URL_SYNTHETIC: "http://synthetic:8000" },
      SYNTHETIC_MANIFESTS,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.support.reason).toContain("informational");
    expect(!result.ok && result.support.reason).toContain("npx copilotkit");
    expect(!result.ok && result.support.reason).not.toMatch(/agent\.graph/);
  });

  it("reports an informational demo under the INFORMATIONAL kind, never 'malformed'", () => {
    // THE KIND, not just the wording. This function used to carry its own
    // `isInformationalDemo` arm that answered `kind: "malformed"`, which
    // `demo-runtime.ts` maps to `error: "not_found"` — while that file has a
    // dedicated `"informational"` code exactly so a caller switching on `error`
    // can tell an unsupported cell from one that never had a runnable surface.
    // So the one arm that NAMED an informational demo filed it under the wrong
    // code. The arm is gone; `resolveDemoSupport` owns the rule, and this pins
    // that the verdict now comes back with the honest kind.
    const result = resolveDemoRequest(
      "synthetic",
      "informational-demo",
      { AGENT_URL_SYNTHETIC: "http://synthetic:8000" },
      SYNTHETIC_MANIFESTS,
    );
    expect(!result.ok && result.support.kind).toBe("informational");

    // ...and on all 20 real manifests, which is where `cli-start` actually
    // lives. Nothing may answer `malformed` for it.
    for (const manifest of listIntegrations()) {
      if (!(manifest.features ?? []).includes("cli-start")) continue;
      const live = resolveDemoRequest(manifest.slug, "cli-start", {});
      expect(!live.ok && live.support.kind, `${manifest.slug}/cli-start`).toBe(
        "informational",
      );
    }
  });

  it("carries the informational CELL FACTS, which the deleted arm dropped", () => {
    // The old arm answered a bare `{ kind: "malformed", reason }` — no slug, no
    // integration name, no demo name — so `CellUnavailable` had nothing to
    // print. Coming from `resolveDemoSupport` the verdict carries them.
    const result = resolveDemoRequest(
      "synthetic",
      "informational-demo",
      {},
      SYNTHETIC_MANIFESTS,
    );
    if (result.ok || result.support.kind !== "informational") {
      throw new Error("expected an informational verdict");
    }
    expect(result.support.slug).toBe("synthetic");
    expect(result.support.integrationName).toBe("Synthetic");
    expect(result.support.demoId).toBe("informational-demo");
    expect(result.support.command).toContain("npx copilotkit");
  });

  it("still serves a row that names an agent but no route — NOT informational", () => {
    // The complement, and the reason the rule is `!route && !agent` rather than
    // `!route`: a demo that names an agent is servable even with no page, and
    // deserves the ordinary agent error rather than this arm.
    const result = resolveDemoRequest(
      "synthetic",
      "agent-only-demo",
      { AGENT_URL_SYNTHETIC: "http://synthetic:8000" },
      [
        {
          name: "Synthetic",
          slug: "synthetic",
          features: ["agent-only-demo"],
          demos: [
            {
              id: "agent-only-demo",
              name: "Agent only",
              agent: { path: "/subagents/agui" },
            },
          ],
        },
      ],
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.resolved.target).toEqual({
      kind: "http",
      url: "http://synthetic:8000/subagents/agui",
    });
  });

  it("resolves a demo the synthetic manifest DOES describe", () => {
    const result = resolveDemoRequest(
      "synthetic",
      "described-demo",
      { AGENT_URL_SYNTHETIC: "http://synthetic:8000" },
      SYNTHETIC_MANIFESTS,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.resolved.target).toEqual({
      kind: "http",
      url: "http://synthetic:8000/",
    });
  });

  it("refuses cli-start on every real integration that lists it", () => {
    // Survives any manifest repair: it asserts the RULE, and cli-start is a
    // copy-paste command cell by design in all 20 manifests.
    let checked = 0;
    for (const manifest of listIntegrations()) {
      if (!(manifest.features ?? []).includes("cli-start")) continue;
      checked += 1;
      const result = resolveDemoRequest(manifest.slug, "cli-start", {});
      expect(result.ok, `${manifest.slug}/cli-start`).toBe(false);
      expect(
        !result.ok && result.support.reason,
        `${manifest.slug}/cli-start`,
      ).toContain("informational");
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it("resolves a demo that HAS an entry, and carries the placeholder report", () => {
    const result = resolveDemoRequest("agno", "subagents", {
      AGENT_URL_AGNO: "http://agno:8000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.target).toEqual({
      kind: "http",
      url: "http://agno:8000/subagents/agui",
    });
    expect(result.resolved.unresolvedPlaceholders).toEqual([]);
  });

  it("still 404s an unknown slug and an unsupported demo", () => {
    expect(
      resolveDemoRequest("no-such-integration", "agentic-chat", {}).ok,
    ).toBe(false);
    const unsupported = resolveDemoRequest("agno", "gen-ui-interrupt", {});
    expect(unsupported.ok).toBe(false);
    expect(!unsupported.ok && unsupported.support.kind).toBe("not-supported");
  });
});
