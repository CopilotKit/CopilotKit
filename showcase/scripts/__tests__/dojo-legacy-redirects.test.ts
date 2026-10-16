import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  LEGACY_FEATURES,
  LEGACY_INTEGRATIONS,
  resolveLegacyDojoPath,
} from "../../shell-dojo/src/lib/legacy-redirects";

const INTEGRATIONS_DIR = resolve(__dirname, "..", "..", "integrations");

// slug → demo ids, read from every integration manifest.
const manifestDemos = new Map<string, Set<string>>();
for (const dir of readdirSync(INTEGRATIONS_DIR)) {
  const path = resolve(INTEGRATIONS_DIR, dir, "manifest.yaml");
  if (!existsSync(path)) continue;
  const manifest = parse(readFileSync(path, "utf8"));
  manifestDemos.set(
    manifest.slug,
    new Set((manifest.demos ?? []).map((d: { id: string }) => d.id)),
  );
}

describe("resolveLegacyDojoPath", () => {
  it.each([
    // Links on copilotkit.ai/ag-ui
    [
      "/langgraph-typescript/feature/shared_state",
      "/?integration=langgraph-typescript&demo=shared-state-read-write",
    ],
    [
      "/langgraph-typescript/feature/subgraphs",
      "/?integration=langgraph-typescript&demo=subagents",
    ],
    [
      "/langgraph-fastapi/feature/tool_based_generative_ui",
      "/?integration=langgraph-fastapi&demo=gen-ui-tool-based",
    ],
    [
      "/langgraph-fastapi/feature/agentic_chat_reasoning",
      "/?integration=langgraph-fastapi&demo=reasoning-default",
    ],
    [
      "/langgraph-fastapi/feature/human_in_the_loop",
      "/?integration=langgraph-fastapi&demo=hitl-in-chat",
    ],
    [
      "/langgraph-fastapi/feature/agentic_generative_ui",
      "/?integration=langgraph-fastapi&demo=gen-ui-agent",
    ],
    [
      "/langgraph-fastapi/feature/predictive_state_updates",
      "/?integration=langgraph-fastapi&demo=shared-state-streaming",
    ],
    // Renamed integration, trailing slash, integration-only page
    [
      "/adk-middleware/feature/agentic_chat/",
      "/?integration=google-adk&demo=agentic-chat",
    ],
    ["/llama-index", "/?integration=llamaindex"],
    // Unmapped feature keeps the integration; unmapped integration → root
    ["/mastra/feature/error_flow", "/?integration=mastra"],
    ["/watsonx/feature/agentic_chat", "/"],
  ])("%s → %s", (from, to) => {
    expect(resolveLegacyDojoPath(from)).toBe(to);
  });

  it("ignores the root and non-legacy shapes", () => {
    expect(resolveLegacyDojoPath("/")).toBeNull();
    expect(resolveLegacyDojoPath("/a/b/c")).toBeNull();
    expect(resolveLegacyDojoPath("/mastra/demo/agentic_chat")).toBeNull();
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
      [...manifestDemos.values()].flatMap((demos) => [...demos]),
    );
    const missing = Object.values(LEGACY_FEATURES).filter(
      (demo) => !allDemos.has(demo),
    );
    expect(missing).toEqual([]);
  });
});
