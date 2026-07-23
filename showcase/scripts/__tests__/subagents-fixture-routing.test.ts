import { describe, expect, it } from "vitest";
import path from "node:path";
import { globSync } from "glob";
import { loadFixtureFile, matchFixture } from "@copilotkit/aimock";
import type {
  ChatCompletionRequest,
  Fixture,
  TextResponse,
  ToolCallResponse,
} from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

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

// D6 subagent fixtures use turnIndex-based chaining instead of toolCallId.
// Each turn in the conversation increments the turn index, and the fixture
// matches on the combination of userMessage + turnIndex + toolName.
//
// Turn 0: initial request → emits research_agent tool call
// Turn 1: after research result → emits writing_agent tool call
// Turn 2: after writing result → emits critique_agent tool call
// Turn 3: after critique result → emits final content
function buildRequest(opts: {
  userMessage: string;
  turnCount?: number;
  toolName?: string;
  toolResultCallId?: string;
}): ChatCompletionRequest {
  const messages: ChatCompletionRequest["messages"] = [
    { role: "user", content: opts.userMessage },
  ];
  // Add assistant+tool turn pairs to reach the desired turnIndex.
  // Each pair simulates the agent calling a sub-agent tool and getting a result.
  const turns = opts.turnCount ?? 0;
  for (let i = 0; i < turns; i++) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: `call_turn_${i}`,
          type: "function",
          function: { name: "sub_agent", arguments: "{}" },
        },
      ],
    });
    messages.push({
      role: "tool",
      content: "ok",
      tool_call_id: `call_turn_${i}`,
    });
  }
  return {
    model: "gpt-5.4",
    messages,
    // D6 fixtures use match.context for per-integration scoping; aimock's
    // matchFixture checks req._context against it.
    _context: "langgraph-python",
    tools: [
      {
        type: "function",
        function: {
          name: "research_agent",
          description: "research",
          parameters: { type: "object" },
        },
      },
      {
        type: "function",
        function: {
          name: "writing_agent",
          description: "writing",
          parameters: { type: "object" },
        },
      },
      {
        type: "function",
        function: {
          name: "critique_agent",
          description: "critique",
          parameters: { type: "object" },
        },
      },
    ],
  } as ChatCompletionRequest;
}

const CHAINS = [
  {
    title: "blog",
    prompt:
      "Produce a short blog post about the benefits of cold exposure training",
    research: "call_d5_subagents_p1_research_001",
    writing: "call_d5_subagents_p1_writing_001",
    critique: "call_d5_subagents_p1_critique_001",
  },
  {
    title: "explain",
    prompt: "Explain how large language models handle tool calling",
    research: "call_d5_subagents_p2_research_001",
    writing: "call_d5_subagents_p2_writing_001",
    critique: "call_d5_subagents_p2_critique_001",
  },
  {
    title: "summarize",
    prompt: "Summarize the current state of reusable rockets",
    research: "call_d5_subagents_p3_research_001",
    writing: "call_d5_subagents_p3_writing_001",
    critique: "call_d5_subagents_p3_critique_001",
  },
] as const;

describe("subagents bundled fixture routing", () => {
  it("each pill chains research -> writing -> critique -> final via turnIndex", () => {
    const fixtures = loadBundledFixtures();
    for (const chain of CHAINS) {
      // Turn 0: initial request → research_agent
      const first = matchFixture(
        fixtures,
        buildRequest({ userMessage: chain.prompt, turnCount: 0 }),
      );
      expect(first, `${chain.title}: first leg should match`).not.toBeNull();
      expect(
        (first!.response as ToolCallResponse).toolCalls?.[0],
      ).toMatchObject({
        id: chain.research,
        name: "research_agent",
      });

      // Turn 1: after research → writing_agent
      const second = matchFixture(
        fixtures,
        buildRequest({ userMessage: chain.prompt, turnCount: 1 }),
      );
      expect(
        second,
        `${chain.title}: second leg (turnIndex=1) should match`,
      ).not.toBeNull();
      expect(
        (second!.response as ToolCallResponse).toolCalls?.[0],
      ).toMatchObject({
        id: chain.writing,
        name: "writing_agent",
      });

      // Turn 2: after writing → critique_agent
      const third = matchFixture(
        fixtures,
        buildRequest({ userMessage: chain.prompt, turnCount: 2 }),
      );
      expect(
        third,
        `${chain.title}: third leg (turnIndex=2) should match`,
      ).not.toBeNull();
      expect(
        (third!.response as ToolCallResponse).toolCalls?.[0],
      ).toMatchObject({
        id: chain.critique,
        name: "critique_agent",
      });

      // Turn 3: after critique → final content
      const final = matchFixture(
        fixtures,
        buildRequest({ userMessage: chain.prompt, turnCount: 3 }),
      );
      expect(
        final,
        `${chain.title}: final leg (turnIndex=3) should match`,
      ).not.toBeNull();
      expect((final!.response as TextResponse).content).toContain(
        "after research",
      );
    }
  });
});
