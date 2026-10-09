import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getInProcessAgentFactory,
  withInProcessRequestScope,
} from "./in-process-agents";
import { forwardingFetch } from "./built-in-agent/header-forwarding";
import {
  stripComments,
  stripCommentsWithMode,
} from "./test-helpers/strip-comments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** showcase/integrations/built-in-agent — the port's upstream source. */
const UPSTREAM = path.resolve(
  HERE,
  "../../../../integrations/built-in-agent/src",
);
/** src/lib/built-in-agent — the ported copy. */
const PORTED = path.join(HERE, "built-in-agent");

/** Ported file -> its upstream twin. Both sides are read verbatim. */
const PORTED_FILES: ReadonlyArray<readonly [string, string]> = [
  ["header-forwarding.ts", "lib/header-forwarding.ts"],
  ["factory/tanstack-factory.ts", "lib/factory/tanstack-factory.ts"],
  ["factory/agentic-chat-factory.ts", "lib/factory/agentic-chat-factory.ts"],
  ["factory/reasoning-factory.ts", "lib/factory/reasoning-factory.ts"],
  ["factory/demo-prompts.ts", "lib/factory/demo-prompts.ts"],
  ["factory/demo-stream.ts", "lib/factory/demo-stream.ts"],
  ["factory/server-tools.ts", "lib/factory/server-tools.ts"],
  ["factory/state-tools.ts", "lib/factory/state-tools.ts"],
  ["factory/subagent-tools.ts", "lib/factory/subagent-tools.ts"],
  ["factory/a2ui-factory.ts", "lib/factory/a2ui-factory.ts"],
  [
    "factory/a2ui-fixed-schema-factory.ts",
    "lib/factory/a2ui-fixed-schema-factory.ts",
  ],
  [
    "factory/beautiful-chat-factory.ts",
    "lib/factory/beautiful-chat-factory.ts",
  ],
  [
    "factory/byoc-hashbrown-factory.ts",
    "lib/factory/byoc-hashbrown-factory.ts",
  ],
  [
    "factory/byoc-json-render-factory.ts",
    "lib/factory/byoc-json-render-factory.ts",
  ],
  ["factory/mcp-apps-factory.ts", "lib/factory/mcp-apps-factory.ts"],
  ["factory/multimodal-factory.ts", "lib/factory/multimodal-factory.ts"],
  ["factory/ogui-factory.ts", "lib/factory/ogui-factory.ts"],
];

/**
 * Ported files with NO byte-identical upstream twin. `agent-config-factory.ts`
 * is an extraction: upstream the agent is written inline inside
 * `src/app/api/copilotkit-agent-config/route.ts`, which this app does not have.
 * It is still source-guarded for `forwardingFetch` below.
 */
const EXTRACTED_FILES: readonly string[] = ["factory/agent-config-factory.ts"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("in-process agent registry", () => {
  it("carries a factory for built-in-agent and nothing else", () => {
    expect(getInProcessAgentFactory("built-in-agent")).toBeTypeOf("function");
    expect(getInProcessAgentFactory("langgraph-python")).toBeUndefined();
  });

  // One representative per builder branch: the generic agent, the
  // agentic_chat named agent, a prompt-carrying agent, a reasoning agent,
  // and the two demos whose dedicated routes ran the generic agent.
  it.each([
    ["chat-customization-css", "chat-customization-css"],
    ["agentic-chat", "agentic_chat"],
    ["gen-ui-agent", "gen-ui-agent"],
    ["subagents", "subagents"],
    ["reasoning-custom", "reasoning-custom"],
    ["frontend-tools", "frontend_tools"],
    ["auth", "auth-demo"],
    ["voice", "voice-demo"],
    ["headless-complete", "headless-complete"],
  ])("builds an agent for %s", (demoId, agentName) => {
    const factory = getInProcessAgentFactory("built-in-agent");
    const agent = factory?.({ slug: "built-in-agent", demoId, agentName });
    expect(agent).toBeTypeOf("object");
    expect(agent).not.toBeNull();
  });

  it("builds by demo id when the manifest sets no agent.name", () => {
    // `resolveAgentName` already returns the demo id in that case, so the
    // agent name IS the demo id by the time it arrives here.
    const factory = getInProcessAgentFactory("built-in-agent");
    expect(
      factory?.({
        slug: "built-in-agent",
        demoId: "shared-state-read-write",
        agentName: "shared-state-read-write",
      }),
    ).toBeTypeOf("object");
  });

  it("REFUSES to serve another demo's agent when agent.name is unknown", () => {
    // The trap: `agent.name` is set and unregistered, while the demo id
    // happens to name a DIFFERENT registered agent. A demo-id fallback would
    // hand this page a working chat driven by the wrong agent.
    const factory = getInProcessAgentFactory("built-in-agent");
    expect(() =>
      factory?.({
        slug: "built-in-agent",
        demoId: "mcp-apps",
        agentName: "typo_in_manifest",
      }),
    ).toThrow(/"mcp-apps".*"typo_in_manifest"/);
  });

  // Every agent that built-in-agent serves from a DEDICATED route with its own
  // factory. These threw until the factories were ported; the list is derived
  // from the `agents:` key of each src/app/api/copilotkit-*/route.ts upstream.
  it.each([
    ["declarative-gen-ui", "declarative-gen-ui"],
    ["a2ui-recovery", "a2ui-recovery"],
    ["a2ui-fixed-schema", "a2ui-fixed-schema"],
    ["mcp-apps", "mcp-apps"],
    ["declarative-json-render", "byoc_json_render"],
    ["beautiful-chat", "beautiful-chat"],
    ["multimodal", "multimodal-demo"],
    ["declarative-hashbrown", "declarative-hashbrown-demo"],
    ["open-gen-ui", "open-gen-ui"],
    ["open-gen-ui-advanced", "open-gen-ui-advanced"],
    ["agent-config", "agent-config-demo"],
  ])("builds the dedicated-route agent for %s", (demoId, agentName) => {
    const factory = getInProcessAgentFactory("built-in-agent");
    const agent = factory?.({ slug: "built-in-agent", demoId, agentName });
    expect(agent).toBeTypeOf("object");
    expect(agent).not.toBeNull();
  });

  it("fails loud for an entirely unknown demo", () => {
    const factory = getInProcessAgentFactory("built-in-agent");
    expect(() =>
      factory?.({
        slug: "built-in-agent",
        demoId: "no-such-demo",
        agentName: "no-such-demo",
      }),
    ).toThrow(/no in-process agent registered/);
  });

  // The fail-loud promise dies on a prototype key: an unguarded
  // `BUILT_IN_AGENT_BUILDERS["constructor"]` is `Object` — truthy and
  // callable — so `build()` returns `{}` and that empty object is handed to
  // CopilotRuntime AS THE AGENT. Exactly the silent fallback this map exists
  // to prevent, and "no-such-demo" does not cover it.
  it.each([
    "constructor",
    "toString",
    "__proto__",
    "valueOf",
    "hasOwnProperty",
  ])("fails loud for the prototype key %s", (name) => {
    const factory = getInProcessAgentFactory("built-in-agent");
    expect(() =>
      factory?.({ slug: "built-in-agent", demoId: name, agentName: name }),
    ).toThrow(/no in-process agent registered/);
  });

  it.each(["constructor", "toString", "__proto__"])(
    "reports no in-process factory for the prototype slug %s",
    (slug) => {
      // A truthy result here means "this integration runs its agent in
      // process", and the slug comes straight off the URL.
      expect(getInProcessAgentFactory(slug)).toBeUndefined();
    },
  );
});

describe("header forwarding", () => {
  /** Spy on global fetch and return the headers of the outbound call. */
  function captureOutboundHeaders(): () => Headers {
    const spy = vi.fn<typeof fetch>(async () => new Response(null));
    vi.stubGlobal("fetch", spy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    return () => new Headers(spy.mock.calls[0]?.[1]?.headers);
  }

  it("carries inbound x-* headers onto the outbound LLM call", async () => {
    const outbound = captureOutboundHeaders();
    const req = {
      headers: new Headers({
        "x-aimock-context": "built-in-agent/agentic-chat",
        "x-test-id": "d6-built-in-agent-1",
        authorization: "Bearer secret",
      }),
    };

    await withInProcessRequestScope("built-in-agent", req, () =>
      forwardingFetch("https://example.test/v1/responses", { method: "POST" }),
    );

    const headers = outbound();
    expect(headers.get("x-aimock-context")).toBe("built-in-agent/agentic-chat");
    expect(headers.get("x-test-id")).toBe("d6-built-in-agent-1");
    // Only x-* headers travel — never credentials off the inbound request.
    expect(headers.get("authorization")).toBeNull();
  });

  it("is a pass-through for a slug with no in-process agent", async () => {
    const outbound = captureOutboundHeaders();
    const req = { headers: new Headers({ "x-aimock-context": "mastra/x" }) };

    await withInProcessRequestScope("mastra", req, () =>
      forwardingFetch("https://example.test/v1/responses"),
    );

    expect(outbound().get("x-aimock-context")).toBeNull();
  });

  it("wires forwardingFetch into every openaiText adapter in the port", () => {
    // The failure this guards: a re-sync drops `fetch: forwardingFetch` from
    // one adapter. Outbound calls then miss every aimock fixture and the cell
    // goes red looking like a model problem.
    const guarded = [...PORTED_FILES.map(([p]) => p), ...EXTRACTED_FILES];
    let matched = 0;
    for (const ported of guarded) {
      // Comments are STRIPPED first, so only real calls are counted. Several
      // files (header-forwarding.ts, agent-config-factory.ts) spell out an
      // `openaiText(...)` call inside a doc comment as an example. Counting
      // prose was an off-by-one in the direction that masks failure: a
      // re-sync that adds a real call site while dropping a comment example
      // keeps the total unchanged and passes silently. It also coupled a
      // frontend test to comment text in a file that is byte-parity-locked
      // to upstream.
      const source = stripComments(
        readFileSync(path.join(PORTED, ported), "utf8"),
      );
      for (const call of source.matchAll(/openaiText\(\s*[\s\S]{0,200}?\)/g)) {
        matched += 1;
        expect(call[0], `${ported}: ${call[0]}`).toContain("forwardingFetch");
      }
    }
    // THE COUNT IS THE POINT. The regex fails OPEN: a call whose first `)`
    // is more than 200 characters away matches nothing at all, so the file
    // is silently unguarded and the loop above still passes. Pinning the
    // number turns that into a red test. Bump it deliberately when a real
    // call site is added or removed.
    expect(matched).toBe(13);
  });

  it("counts no openaiText call that only exists in a comment", () => {
    // Direct proof of the property the count above depends on. The doc
    // comment in header-forwarding.ts names `openaiText(...)` as an
    // example; the file declares no adapter, so it must contribute zero.
    const source = stripComments(
      readFileSync(path.join(PORTED, "header-forwarding.ts"), "utf8"),
    );
    expect([...source.matchAll(/openaiText\(/g)]).toEqual([]);
  });

  it("strips every guarded file WITHOUT the scanner getting lost", () => {
    // The count above only means something if the stripper actually reached
    // the end of each file in `code` mode. It is not a JS lexer — a regex
    // literal holding a quote (`/["']/`) flips it into string mode and it
    // swallows source to the next matching quote, taking real `openaiText(`
    // call sites with it and leaving the count unchanged. That failure is
    // otherwise SILENT. See src/lib/test-helpers/strip-comments.ts.
    for (const ported of [
      ...PORTED_FILES.map(([p]) => p),
      ...EXTRACTED_FILES,
    ]) {
      const { endMode } = stripCommentsWithMode(
        readFileSync(path.join(PORTED, ported), "utf8"),
      );
      expect(endMode, `${ported}: comment stripper ended in ${endMode}`).toBe(
        "code",
      );
    }
  });
});

describe("the ported tree is fully accounted for", () => {
  /** Every `.ts` file under src/lib/built-in-agent, POSIX-separated. */
  function portedTree(dir = PORTED, prefix = ""): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        return portedTree(path.join(dir, entry.name), rel);
      return entry.name.endsWith(".ts") ? [rel] : [];
    });
  }

  it("lists every ported file in PORTED_FILES or EXTRACTED_FILES", () => {
    // Both lists are hand-maintained. A new factory that nobody adds to them
    // is unguarded for `forwardingFetch` AND unchecked for byte drift, and
    // nothing says so. Reading the tree from disk is what says so.
    const declared = new Set([
      ...PORTED_FILES.map(([ported]) => ported),
      ...EXTRACTED_FILES,
    ]);
    const undeclared = portedTree().filter((file) => !declared.has(file));
    expect(undeclared).toEqual([]);
  });

  it("lists no file that is not on disk", () => {
    const onDisk = new Set(portedTree());
    const missing = [
      ...PORTED_FILES.map(([ported]) => ported),
      ...EXTRACTED_FILES,
    ].filter((file) => !onDisk.has(file));
    expect(missing).toEqual([]);
  });
});

describe("port parity with showcase/integrations/built-in-agent", () => {
  it.each(PORTED_FILES)(
    "%s is byte-identical to its source",
    (ported, upstream) => {
      expect(readFileSync(path.join(PORTED, ported), "utf8")).toBe(
        readFileSync(path.join(UPSTREAM, upstream), "utf8"),
      );
    },
  );
});
