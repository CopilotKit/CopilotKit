import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadFixtureFile, matchFixture } from "@copilotkit/aimock";
import type { ChatCompletionRequest, Fixture } from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PROMPT = "3D axis visualization (model airplane)";

function fixtures(): Fixture[] {
  return [
    ...loadFixtureFile(
      path.join(
        REPO_ROOT,
        "showcase/aimock/d6/built-in-agent/gen-ui-open.json",
      ),
    ),
    ...loadFixtureFile(
      path.join(
        REPO_ROOT,
        "showcase/aimock/d6/built-in-agent/gen-ui-tool-based.json",
      ),
    ),
  ];
}

function request(
  messages: ChatCompletionRequest["messages"],
): ChatCompletionRequest {
  return {
    model: "gpt-5.4",
    messages,
    _context: "built-in-agent",
  } as ChatCompletionRequest;
}

describe("strict turn-index fixture routing", () => {
  it("does not reuse a turn-zero Open Gen UI fixture after its tool result", () => {
    const candidates = fixtures();
    const first = matchFixture(
      candidates,
      request([{ role: "user", content: PROMPT }]),
      undefined,
      undefined,
      { strictTurnIndex: true },
    );
    expect(first?.response).toHaveProperty("toolCalls");

    const followUpRequest = request([
      { role: "user", content: PROMPT },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "fc-runtime-generated",
            type: "function",
            function: { name: "generateSandboxedUi", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "fc-runtime-generated",
        content: "UI generated",
      },
    ]);

    const relaxed = matchFixture(candidates, followUpRequest);
    expect(relaxed?.response).toMatchObject({
      toolCalls: [{ id: "call_d5_open_gen_ui_3d_axis_001" }],
    });

    const strict = matchFixture(
      candidates,
      followUpRequest,
      undefined,
      undefined,
      { strictTurnIndex: true },
    );
    expect(strict?.response).toMatchObject({
      content: expect.stringContaining("rendered above"),
    });
  });
});
