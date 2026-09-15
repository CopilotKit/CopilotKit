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

test("the visual FrameworkSetup path links the Google ADK termination callback", async () => {
  const result = await FrameworkSetup({
    concept: "state-streaming-setup",
    currentFramework: "google-adk",
  });
  expect(result).not.toBeNull();
  if (!result) {
    throw new Error("Expected Google ADK state-streaming setup content");
  }
  const source = (result.props as { children?: unknown }).children;

  expect(source).toContain("after_model_callback=stop_on_terminal_text");
  expect(source).toContain("shared_chat.py");
  expect(source).not.toContain("def stop_on_terminal_text(");
  expect(source).not.toContain("@region[");
  expect(mocks.mdxRemote).toHaveBeenCalledOnce();
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

test.each([
  ["claude-sdk-python", "tools=[SET_NOTES_TOOL]"],
  ["claude-sdk-typescript", "mcp__copilotkit__set_notes"],
])(
  "the visual FrameworkSetup path renders %s shared-state wiring",
  async (framework, expectedIdentifier) => {
    const result = await FrameworkSetup({
      concept: "shared-state-setup",
      currentFramework: framework,
    });
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error(`Expected ${framework} shared-state setup content`);
    }
    const source = (result.props as { children?: unknown }).children;

    expect(source).toContain(expectedIdentifier);
    expect(source).not.toContain("<DemoCode");
    expect(source).not.toContain("@region[");
    expect(mocks.mdxRemote).toHaveBeenCalledOnce();
  },
);

// A snippet that is not bundled and a bundled snippet that fails to compile both left
// `FrameworkSetup` returning `null`, so a rendering defect shipped looking exactly like a
// deliberate omission — the only trace a `console.error` nobody reads in production
// (OSS-1036). Absence is a real state and stays quiet; a broken snippet is not.
//
// The unbundled case is pinned with a concept name that is deliberately never bundled,
// not with a framework slug. Naming a real gap made this test depend on that gap staying
// open: it was `ag2`, and closing the last nine `frontend-tools-setup` gaps (OSS-1036)
// would have turned it red for the right reason.
test("a concept nobody bundled for this framework renders nothing, quietly", async () => {
  const result = await FrameworkSetup({
    concept: "concept-that-is-never-bundled",
    currentFramework: "ag2",
  });

  expect(result).toBeNull();
  expect(mocks.mdxRemote).not.toHaveBeenCalled();
});

test("a bundled snippet that fails to compile is loud, not null", async () => {
  mocks.mdxRemote.mockRejectedValueOnce(new Error("Unexpected token"));

  await expect(
    FrameworkSetup({
      concept: "frontend-tools-setup",
      currentFramework: "google-adk",
    }),
  ).rejects.toThrow(/frontend-tools-setup.*google-adk/);
});
