import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  LEGACY_FEATURES,
  LEGACY_INTEGRATIONS,
  resolveLegacyDojoRedirect,
} from "../../shell-dojo/src/lib/legacy-redirects";

const INTEGRATIONS_DIR = resolve(__dirname, "..", "..", "integrations");

// slug → (demo id → route), read from every integration manifest.
const manifestDemos = new Map<string, Map<string, string>>();
for (const dir of readdirSync(INTEGRATIONS_DIR)) {
  const path = resolve(INTEGRATIONS_DIR, dir, "manifest.yaml");
  if (!existsSync(path)) continue;
  const manifest = parse(readFileSync(path, "utf8"));
  manifestDemos.set(
    manifest.slug,
    new Map(
      (manifest.demos ?? []).map((d: { id: string; route?: string }) => [
        d.id,
        d.route,
      ]),
    ),
  );
}

const lookups = {
  demoRoute: (slug: string, demo: string) => manifestDemos.get(slug)?.get(demo),
  backendUrl: (slug: string) => `https://showcase-${slug}.example`,
};

function redirect(pathAndQuery: string) {
  return resolveLegacyDojoRedirect(
    new URL(pathAndQuery, "https://dojo.ag-ui.com"),
    lookups,
  );
}

describe("resolveLegacyDojoRedirect", () => {
  it.each([
    // Links on copilotkit.ai/ag-ui (without ?sidebar=false)
    [
      "/langgraph-typescript/feature/shared_state",
      "/?integration=langgraph-typescript&demo=shared-state-read-write",
    ],
    [
      "/langgraph-typescript/feature/subgraphs",
      "/?integration=langgraph-typescript&demo=subagents",
    ],
    // Renamed integrations, trailing slash, integration-only page
    [
      "/adk-middleware/feature/agentic_chat/",
      "/?integration=google-adk&demo=agentic-chat",
    ],
    ["/llama-index", "/?integration=llamaindex"],
    [
      "/llamaindex/feature/shared_state",
      "/?integration=llamaindex&demo=shared-state-read-write",
    ],
    ["/antigravity", "/?integration=google-antigravity"],
    // Params the dojo doesn't support are dropped
    [
      "/adk-middleware/feature/shared_state?openCopilot=true&view=code",
      "/?integration=google-adk&demo=shared-state-read-write",
    ],
    // Integration-specific multi-agent features (review feedback)
    [
      "/langgraph-fastapi/feature/deepagents_subagents",
      "/?integration=langgraph-fastapi&demo=subagents",
    ],
    [
      "/aws-strands/feature/multi_agent",
      "/?integration=strands&demo=subagents",
    ],
    [
      "/aws-strands-typescript/feature/multi_agent",
      "/?integration=strands-typescript&demo=subagents",
    ],
    // Unmapped feature keeps the integration; unmapped integration → root
    ["/mastra/feature/error_flow", "/?integration=mastra"],
    ["/watsonx/feature/agentic_chat", "/"],
  ])("%s → %s", (from, to) => {
    expect(redirect(from)).toEqual({ location: to, permanent: true });
  });

  it.each([
    // Embedded links on copilotkit.ai/ag-ui
    [
      "/langgraph-fastapi/feature/shared_state?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/shared-state-read-write",
    ],
    [
      "/langgraph-fastapi/feature/tool_based_generative_ui?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/gen-ui-tool-based",
    ],
    [
      "/langgraph-fastapi/feature/subgraphs?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/subagents",
    ],
    [
      "/langgraph-fastapi/feature/agentic_chat_reasoning?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/reasoning-default",
    ],
    [
      "/langgraph-fastapi/feature/human_in_the_loop?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/hitl-in-chat",
    ],
    [
      "/langgraph-fastapi/feature/agentic_generative_ui?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/gen-ui-agent",
    ],
    [
      "/langgraph-fastapi/feature/predictive_state_updates?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/shared-state-streaming",
    ],
    // Integration-specific multi-agent features (review feedback)
    [
      "/langgraph-fastapi/feature/deepagents_subagents?sidebar=false",
      "https://showcase-langgraph-fastapi.example/demos/subagents",
    ],
    [
      "/aws-strands/feature/multi_agent?sidebar=false",
      "https://showcase-strands.example/demos/subagents",
    ],
    [
      "/aws-strands-typescript/feature/multi_agent?sidebar=false",
      "https://showcase-strands-typescript.example/demos/subagents",
    ],
  ])("embedded %s → %s", (from, to) => {
    expect(redirect(from)).toEqual({ location: to, permanent: false });
  });

  it("falls back to the dojo when an embed has no demo page to land on", () => {
    // Integration doesn't ship the demo.
    expect(
      redirect("/langgraph-fastapi/feature/background_agents?sidebar=false"),
    ).toEqual({
      location: "/?integration=langgraph-fastapi&demo=background-agents",
      permanent: true,
    });
    // No feature at all.
    expect(redirect("/langgraph-fastapi?sidebar=false")).toEqual({
      location: "/?integration=langgraph-fastapi",
      permanent: true,
    });
  });

  it("ignores the root and non-legacy shapes", () => {
    expect(redirect("/")).toBeNull();
    expect(redirect("/a/b/c")).toBeNull();
    expect(redirect("/mastra/demo/agentic_chat")).toBeNull();
  });

  it("accounts for every feature the legacy dojo ever shipped", () => {
    // Every feature id from the legacy dojo's git history
    // (ag-ui apps/dojo menu.ts + feature routes). Each must be mapped or
    // listed in UNMAPPED with no showcase counterpart.
    const HISTORICAL = [
      "a2a_chat",
      "a2ui_advanced",
      "a2ui_chat",
      "a2ui_dynamic_schema",
      "a2ui_fixed_schema",
      "a2ui_fixed_schema_streaming",
      "a2ui_recovery",
      "ag_ui_docs_copilot",
      "agentic_chat",
      "agentic_chat_citations",
      "agentic_chat_multimodal",
      "agentic_chat_reasoning",
      "agentic_generative_ui",
      "backend_tool_rendering",
      "background_agents",
      "crew_chat",
      "custom_lifecycle_events",
      "deepagents_subagents",
      "dynamic_system_prompt",
      "error_flow",
      "google_a2ui_dynamic_schema",
      "google_a2ui_recovery",
      "google_a2ui_streaming",
      "google_a2ui_streaming_explicit",
      "handoff",
      "human_in_the_loop",
      "human_in_the_loop_approval",
      "interrupt",
      "multi_agent",
      "observational_memory",
      "open_gen_ui",
      "predictive_state_updates",
      "secure_tools",
      "shared_state",
      "subagents",
      "subgraphs",
      "tool_based_generative_ui",
      "v1_agentic_chat",
      "vnext_chat",
    ];
    const UNMAPPED = new Set([
      "a2a_chat",
      "ag_ui_docs_copilot",
      "agentic_chat_citations",
      "crew_chat",
      "custom_lifecycle_events",
      "dynamic_system_prompt",
      "error_flow",
      "secure_tools",
      "vnext_chat",
    ]);
    const unaccounted = HISTORICAL.filter(
      (id) => !(id in LEGACY_FEATURES) && !UNMAPPED.has(id),
    );
    expect(unaccounted).toEqual([]);
  });

  it("only targets integrations that exist", () => {
    for (const slug of new Set(Object.values(LEGACY_INTEGRATIONS))) {
      expect(manifestDemos.has(slug), slug).toBe(true);
    }
  });

  it("only targets demos that exist", () => {
    // Per-integration gaps are fine: the dojo falls back to that
    // integration's first demo when ?demo= isn't one it ships.
    const allDemos = new Set(
      [...manifestDemos.values()].flatMap((demos) => [...demos.keys()]),
    );
    const missing = Object.values(LEGACY_FEATURES).filter(
      (demo) => !allDemos.has(demo),
    );
    expect(missing).toEqual([]);
  });
});
