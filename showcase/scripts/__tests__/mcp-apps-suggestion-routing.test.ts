import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadFixtureFile, matchFixture } from "@copilotkit/aimock";
import type {
  ChatCompletionRequest,
  Fixture,
  TextResponse,
  ToolCallResponse,
} from "@copilotkit/aimock";

// Regression guard for the MCP Apps demo suggestion pills
// (showcase/integrations/langgraph-python/src/app/demos/mcp-apps/suggestions.ts).
//
// Bug class this test catches: a pill's verbatim `message` falls through
// the d5-all.json mcp-apps fixtures and gets absorbed by a generic
// substring catch-all later in the load chain (e.g.
// feature-parity.json's `{userMessage: "steps"}`), producing a
// content-only response with no `create_view` tool call. The agent
// never invokes the MCP tool, the runtime never fetches the UI
// resource, and the sandboxed iframe never mounts. The chat looks like
// it "works" — it just silently no-ops the demo's whole point.
//
// We use aimock's `matchFixture` directly (no HTTP) so the test is
// fast and deterministic: same matcher, same fixture load order as
// docker-compose.local.yml.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AIMOCK_DIR = path.join(REPO_ROOT, "showcase", "aimock");
const SUGGESTIONS_PATH = path.join(
  REPO_ROOT,
  "showcase",
  "integrations",
  "langgraph-python",
  "src",
  "app",
  "demos",
  "mcp-apps",
  "suggestions.ts",
);

// Mirror showcase/docker-compose.local.yml's aimock command:
//   --fixtures d5-all.json --fixtures smoke.json --fixtures feature-parity.json
// aimock uses first-match-wins, so this order is load-bearing.
const FIXTURE_FILES = ["d5-all.json", "smoke.json", "feature-parity.json"];

function loadBundledFixtures(): Fixture[] {
  return FIXTURE_FILES.flatMap((f) =>
    loadFixtureFile(path.join(AIMOCK_DIR, f)),
  );
}

function buildRequest(opts: {
  userMessage: string;
  withCreateViewTool?: boolean;
  toolResult?: { callId: string };
}): ChatCompletionRequest {
  const messages: ChatCompletionRequest["messages"] = [
    { role: "user", content: opts.userMessage },
  ];
  if (opts.toolResult) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: opts.toolResult.callId,
          type: "function",
          function: { name: "create_view", arguments: "{}" },
        },
      ],
    });
    messages.push({
      role: "tool",
      content: "ok",
      tool_call_id: opts.toolResult.callId,
    });
  }
  return {
    model: "gpt-5.4",
    messages,
    tools: opts.withCreateViewTool
      ? [
          {
            type: "function",
            function: {
              name: "create_view",
              description: "Excalidraw MCP tool",
              parameters: { type: "object" },
            },
          },
        ]
      : undefined,
  };
}

// One row per suggestion pill in suggestions.ts. `expectedFixtureKey`
// is the load-bearing substring the d5-all.json fixture is keyed on —
// it MUST be a substring of `message` (aimock matches `userMessage`
// case-sensitively via String.prototype.includes — see
// node_modules/@copilotkit/aimock/dist/router.js#matchFixture).
const PILLS = [
  {
    title: "Draw a flowchart",
    message: "Use Excalidraw to draw a simple flowchart with three steps.",
    expectedFixtureKey: "draw a simple flowchart",
    expectedToolCallId: "call_d5_mcp_apps_create_view_flowchart_001",
  },
  {
    title: "Sketch a system diagram",
    message:
      "Open Excalidraw and sketch a system diagram with a client, server, and database.",
    expectedFixtureKey: "Open Excalidraw and sketch a system diagram",
    expectedToolCallId: "call_d5_mcp_apps_create_view_001",
  },
] as const;

describe("MCP Apps suggestion-pill fixture routing", () => {
  it("suggestions.ts still uses the exact pill messages this test asserts on", () => {
    const src = readFileSync(SUGGESTIONS_PATH, "utf8");
    for (const pill of PILLS) {
      expect(
        src.includes(pill.message),
        `suggestions.ts no longer contains pill message:\n  "${pill.message}"\n` +
          `If you re-worded a pill, update both the matching fixture in ` +
          `showcase/aimock/d5-all.json (and its mirror in ` +
          `showcase/harness/fixtures/d5/mcp-apps.json) AND the PILLS table ` +
          `in this test so the new wording still routes to the create_view ` +
          `fixture.`,
      ).toBe(true);
      expect(
        pill.message.includes(pill.expectedFixtureKey),
        `Pill "${pill.title}" message must contain fixture key ` +
          `"${pill.expectedFixtureKey}" as a substring — aimock's userMessage ` +
          `matcher is case-sensitive String.includes.`,
      ).toBe(true);
    }
  });

  it("turn 1: each pill routes to its create_view fixture (not a content-only catch-all)", () => {
    const fixtures = loadBundledFixtures();
    for (const pill of PILLS) {
      const req = buildRequest({
        userMessage: pill.message,
        withCreateViewTool: true,
      });
      const matched = matchFixture(fixtures, req);
      expect(
        matched,
        `Pill "${pill.title}" — no fixture matched. The pill prompt would ` +
          `fall through to a 404, leaving the chat hung on the spinner.`,
      ).not.toBeNull();

      const resp = matched!.response as Partial<ToolCallResponse> &
        Partial<TextResponse>;
      const toolName = resp.toolCalls?.[0]?.name;
      expect(
        toolName,
        `Pill "${pill.title}" — matched fixture did not emit a create_view ` +
          `tool call. Got response: ${JSON.stringify(resp)}. A non-MCP fixture ` +
          `(e.g. feature-parity.json's \`{userMessage: "steps"}\` content-only ` +
          `blurb) is absorbing the pill prompt, so the runtime never invokes ` +
          `the MCP tool and the sandboxed iframe never mounts.`,
      ).toBe("create_view");
      expect(
        resp.toolCalls?.[0]?.id,
        `Pill "${pill.title}" — matched the wrong create_view fixture ` +
          `(unexpected tool_call id). The narration fixture won't fire on the ` +
          `follow-up request and the chat will hang.`,
      ).toBe(pill.expectedToolCallId);
    }
  });

  it("turn 2 (post tool result): each pill routes to its narration fixture", () => {
    const fixtures = loadBundledFixtures();
    for (const pill of PILLS) {
      const req = buildRequest({
        userMessage: pill.message,
        toolResult: { callId: pill.expectedToolCallId },
      });
      const matched = matchFixture(fixtures, req);
      expect(
        matched,
        `Pill "${pill.title}" — no fixture matched the post-tool-result ` +
          `request. Without this, the chat will hang waiting for the ` +
          `agent's final reply after the MCP iframe renders.`,
      ).not.toBeNull();

      const resp = matched!.response as Partial<TextResponse> &
        Partial<ToolCallResponse>;
      expect(
        typeof resp.content === "string" && resp.content.length > 0,
        `Pill "${pill.title}" — turn-2 fixture is missing user-visible content.`,
      ).toBe(true);
      expect(
        resp.toolCalls,
        `Pill "${pill.title}" — turn-2 fixture must be content-only; emitting ` +
          `another tool call here would loop the agent on the same MCP tool.`,
      ).toBeUndefined();
    }
  });
});
