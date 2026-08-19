import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mdxRemote: vi.fn(async ({ source }: { source: string }) => ({
    type: "article",
    props: { children: source },
  })),
}));

vi.mock("next-mdx-remote/rsc", () => ({ MDXRemote: mocks.mdxRemote }));

import { FrameworkSetup } from "../setup-concept";

beforeEach(() => {
  mocks.mdxRemote.mockClear();
});

test("the visual FrameworkSetup path renders Claude TypeScript SDK/MCP wiring", async () => {
  const result = await FrameworkSetup({
    concept: "a2ui-fixed-schema-setup",
    currentFramework: "claude-sdk-typescript",
  });
  expect(result).not.toBeNull();
  if (!result) {
    throw new Error("Expected Claude TypeScript setup content");
  }
  const source = (result.props as { children?: unknown }).children;

  expect(source).toContain("new ClaudeAgentAdapter({");
  expect(source).toContain("createSdkMcpServer({");
  expect(source).toContain("mcp__copilotkit__display_flight");
  expect(mocks.mdxRemote).toHaveBeenCalledOnce();
});

test("the visual FrameworkSetup path stays empty for other frameworks", async () => {
  const result = await FrameworkSetup({
    concept: "a2ui-fixed-schema-setup",
    currentFramework: "langgraph-typescript",
  });

  expect(result).toBeNull();
  expect(mocks.mdxRemote).not.toHaveBeenCalled();
});

test.each([
  ["claude-sdk-python", "create_sdk_mcp_server("],
  ["claude-sdk-typescript", "createSdkMcpServer({"],
])(
  "the visual FrameworkSetup path renders %s tool wiring",
  async (framework, expectedIdentifier) => {
    const result = await FrameworkSetup({
      concept: "tool-rendering-setup",
      currentFramework: framework,
    });
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error(`Expected ${framework} tool-rendering setup content`);
    }
    const source = (result.props as { children?: unknown }).children;

    expect(source).toContain(expectedIdentifier);
    expect(source).toContain("ClaudeAgentAdapter");
    expect(source).toContain(
      "register this schema as an executable backend tool",
    );
  },
);
