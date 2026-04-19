/**
 * Type-level test for `BuiltAgents`. Purpose: if someone relaxes the type
 * back to `Record<string, ...>` or mistypes a demo key, this file should
 * fail `tsc --noEmit`. There are zero runtime assertions — the value of
 * this test is in whether `npx tsc --noEmit` passes for this file.
 */

import { describe, expect, it, vi } from "vitest";

// Stubs so route.ts imports resolve under vitest-node.
vi.mock("@/mastra", () => ({ mastra: { __stub: "mastra" } }));
vi.mock("@ag-ui/mastra", () => ({
  MastraAgent: { getLocalAgents: vi.fn() },
  getLocalAgent: vi.fn(),
}));
vi.mock("@copilotkit/runtime", () => ({
  CopilotRuntime: vi.fn(),
  ExperimentalEmptyAdapter: vi.fn(),
  copilotRuntimeNextJSAppRouterEndpoint: vi.fn(() => ({
    handleRequest: vi.fn(async () => new Response("ok")),
  })),
}));
vi.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import {
  buildAgents,
  demoAgentNames,
  type BuiltAgents,
  type DemoAgentName,
} from "../../src/app/api/copilotkit/route";

// Helper: "these two types are assignable in both directions" (i.e. equal).
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Assert<T extends true> = T;

// 1. `DemoAgentName` must be the literal union of the entries in `demoAgentNames`,
//    not just `string`. If someone drops `as const`, this breaks.
type _DemoAgentNameIsLiteralUnion = Assert<
  Equals<
    DemoAgentName,
    | "agentic_chat"
    | "human_in_the_loop"
    | "tool-rendering"
    | "gen-ui-tool-based"
    | "gen-ui-agent"
    | "shared-state-read"
    | "shared-state-write"
    | "shared-state-streaming"
    | "subagents"
  >
>;

// 2. `BuiltAgents` keys must be exactly `DemoAgentName | "weatherAgent"`.
type _BuiltAgentsKeys = Assert<
  Equals<keyof BuiltAgents, DemoAgentName | "weatherAgent">
>;

// 3. Unknown keys must NOT be allowed. We assert this with a ts-expect-error
//    pinned to the offending property line so it captures the TS2353 error.
type _AgentValue = NonNullable<ReturnType<typeof buildAgents>>["weatherAgent"];

const _badKey: BuiltAgents = {
  // The next line must fail to compile (unknown key). Remove the directive and
  // `tsc --noEmit` should error; add a drift-introducing key and the directive
  // will become "unused" and `tsc --noEmit` will error.
  // @ts-expect-error "totally-unknown-agent" is not a valid BuiltAgents key
  "totally-unknown-agent": {} as _AgentValue,
  weatherAgent: {} as _AgentValue,
  agentic_chat: {} as _AgentValue,
  human_in_the_loop: {} as _AgentValue,
  "tool-rendering": {} as _AgentValue,
  "gen-ui-tool-based": {} as _AgentValue,
  "gen-ui-agent": {} as _AgentValue,
  "shared-state-read": {} as _AgentValue,
  "shared-state-write": {} as _AgentValue,
  "shared-state-streaming": {} as _AgentValue,
  subagents: {} as _AgentValue,
};

describe("BuiltAgents type narrowing", () => {
  it("keeps the type compile-time checks referenced so tree-shaking doesn't drop the file", () => {
    // Use the types so they aren't considered unused by TS (noUnusedLocals etc.).
    const _keep: [
      _DemoAgentNameIsLiteralUnion,
      _BuiltAgentsKeys,
      typeof _badKey,
      typeof demoAgentNames,
    ] = [true, true, _badKey, demoAgentNames];
    expect(_keep.length).toBe(4);
  });
});
