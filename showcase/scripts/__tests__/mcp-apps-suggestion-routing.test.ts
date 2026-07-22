import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "glob";
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
// the per-integration mcp-apps fixtures and gets absorbed by a generic
// substring catch-all later in the load chain, producing a content-only
// response with no `create_view` tool call. The agent never invokes the
// MCP tool, the runtime never fetches the UI resource, and the sandboxed
// iframe never mounts. The chat looks like it "works" — it just silently
// no-ops the demo's whole point.
//
// We use aimock's `matchFixture` directly (no HTTP) so the test is
// fast and deterministic: same matcher, same fixture load order as
// docker-compose.local.yml.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
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

interface FixtureDocument {
  fixtures?: Array<{
    response?: {
      toolCalls?: Array<{
        name?: unknown;
        arguments?: unknown;
      }>;
    };
  }>;
}

/**
 * Return every checked-in fixture that can emit an Excalidraw MCP tool call.
 */
function listCreateViewFixturePaths(): string[] {
  return globSync(
    [
      "showcase/aimock/d6/**/*.json",
      "showcase/harness/fixtures/d5/mcp-apps.json",
    ],
    {
      cwd: REPO_ROOT,
      absolute: true,
    },
  ).filter((fixturePath) =>
    readFileSync(fixturePath, "utf8").includes('"name": "create_view"'),
  );
}

// Load fixtures for a single integration (langgraph-python, the reference
// integration) plus shared. At runtime each integration only sees its own
// scoped fixtures via X-AIMock-Context, so loading a single integration's
// fixture set is the correct simulation — loading all 18 integrations'
// fixtures would produce first-match collisions across identical prompts.
function loadBundledFixtures(): Fixture[] {
  const fixtureFiles = [
    ...globSync("showcase/aimock/shared/*.json", {
      cwd: REPO_ROOT,
      absolute: true,
    }),
    ...globSync("showcase/aimock/d4/langgraph-python/*.json", {
      cwd: REPO_ROOT,
      absolute: true,
    }),
    ...globSync("showcase/aimock/d6/langgraph-python/*.json", {
      cwd: REPO_ROOT,
      absolute: true,
    }),
  ];
  return fixtureFiles.flatMap((f) => loadFixtureFile(f));
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
    // D6 fixtures use match.context for per-integration scoping; aimock's
    // matchFixture checks req._context against it.
    _context: "langgraph-python",
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
  } as ChatCompletionRequest;
}

// One row per suggestion pill in suggestions.ts. `expectedFixtureKey`
// is the load-bearing substring the mcp-apps fixture is keyed on —
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
  it("uses the current create_view string contract in every fixture", () => {
    const fixturePaths = listCreateViewFixturePaths();
    let createViewCalls = 0;

    for (const fixturePath of fixturePaths) {
      const document = JSON.parse(
        readFileSync(fixturePath, "utf8"),
      ) as FixtureDocument;
      for (const [fixtureIndex, fixture] of (
        document.fixtures ?? []
      ).entries()) {
        for (const toolCall of fixture.response?.toolCalls ?? []) {
          if (toolCall.name !== "create_view") continue;
          createViewCalls += 1;

          const location = `${path.relative(REPO_ROOT, fixturePath)} fixture ${fixtureIndex}`;
          expect(
            typeof toolCall.arguments,
            `${location}: create_view arguments must be serialized JSON`,
          ).toBe("string");
          const args = JSON.parse(String(toolCall.arguments)) as {
            elements?: unknown;
          };
          expect(
            typeof args.elements,
            `${location}: create_view.elements must be a JSON-array string`,
          ).toBe("string");
          expect(
            Array.isArray(JSON.parse(String(args.elements))),
            `${location}: create_view.elements must decode to an array`,
          ).toBe(true);
        }
      }
    }

    expect(createViewCalls).toBeGreaterThan(0);
  });

  it("suggestions.ts still uses the exact pill messages this test asserts on", () => {
    const src = readFileSync(SUGGESTIONS_PATH, "utf8");
    for (const pill of PILLS) {
      expect(
        src.includes(pill.message),
        `suggestions.ts no longer contains pill message:\n  "${pill.message}"\n` +
          `If you re-worded a pill, update both the matching fixture in ` +
          `showcase/aimock/d6/*/mcp-apps.json AND the PILLS table ` +
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
