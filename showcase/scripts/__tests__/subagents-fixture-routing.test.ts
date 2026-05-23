import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadFixtureFile, matchFixture } from "@copilotkit/aimock";
import type {
  ChatCompletionRequest,
  Fixture,
  TextResponse,
  ToolCallResponse,
} from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AIMOCK_DIR = path.join(REPO_ROOT, "showcase", "aimock");
const FIXTURE_FILES = ["d5-all.json", "smoke.json", "feature-parity.json"];

function loadBundledFixtures(): Fixture[] {
  return FIXTURE_FILES.flatMap((f) =>
    loadFixtureFile(path.join(AIMOCK_DIR, f)),
  );
}

function buildRequest(opts: {
  userMessage: string;
  toolResultCallId?: string;
}): ChatCompletionRequest {
  const messages: ChatCompletionRequest["messages"] = [
    { role: "user", content: opts.userMessage },
  ];
  if (opts.toolResultCallId) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: opts.toolResultCallId,
          type: "function",
          function: { name: "sub_agent", arguments: "{}" },
        },
      ],
    });
    messages.push({
      role: "tool",
      content: "ok",
      tool_call_id: opts.toolResultCallId,
    });
  }
  return {
    model: "gpt-5.4",
    messages,
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
  };
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
  it("each pill chains research -> writing -> critique -> final via toolCallId", () => {
    const fixtures = loadBundledFixtures();
    for (const chain of CHAINS) {
      const first = matchFixture(
        fixtures,
        buildRequest({ userMessage: chain.prompt }),
      );
      expect(first, `${chain.title}: first leg should match`).not.toBeNull();
      expect(
        (first!.response as ToolCallResponse).toolCalls?.[0],
      ).toMatchObject({
        id: chain.research,
        name: "research_agent",
      });

      const second = matchFixture(
        fixtures,
        buildRequest({
          userMessage: chain.prompt,
          toolResultCallId: chain.research,
        }),
      );
      expect(
        (second!.response as ToolCallResponse).toolCalls?.[0],
      ).toMatchObject({
        id: chain.writing,
        name: "writing_agent",
      });

      const third = matchFixture(
        fixtures,
        buildRequest({
          userMessage: chain.prompt,
          toolResultCallId: chain.writing,
        }),
      );
      expect(
        (third!.response as ToolCallResponse).toolCalls?.[0],
      ).toMatchObject({
        id: chain.critique,
        name: "critique_agent",
      });

      const final = matchFixture(
        fixtures,
        buildRequest({
          userMessage: chain.prompt,
          toolResultCallId: chain.critique,
        }),
      );
      expect((final!.response as TextResponse).content).toContain(
        "after research",
      );
    }
  });
});
