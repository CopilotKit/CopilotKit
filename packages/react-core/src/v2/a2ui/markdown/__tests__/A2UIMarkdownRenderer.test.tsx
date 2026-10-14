import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { basicCatalog } from "@copilotkit/a2ui-renderer";
import type { Theme } from "@copilotkit/a2ui-renderer";
import { A2UIMarkdownProvider } from "../A2UIMarkdownContext";
import type { A2UIMarkdownConfig } from "../A2UIMarkdownContext";
import { A2UIMarkdownRenderer } from "../A2UIMarkdownRenderer";

const mocks = vi.hoisted(() => {
  const agent = { addMessage: vi.fn() };
  const copilotkit = {
    properties: {} as Record<string, unknown>,
    setProperties: vi.fn(),
    getAgent: vi.fn(() => agent),
    runAgent: vi.fn().mockResolvedValue(undefined),
  };
  return { agent, copilotkit };
});

vi.mock("../../../providers", () => ({
  useCopilotKit: () => ({ copilotkit: mocks.copilotkit }),
}));
vi.mock("../../../providers/CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: () => ({ agentId: "default" }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const BASIC_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json";
const config: A2UIMarkdownConfig = {
  catalog: basicCatalog,
  catalogId: BASIC_ID,
  theme: {} as Theme,
  actionMode: "message",
};

function tree(content: string, value: A2UIMarkdownConfig = config) {
  return (
    <A2UIMarkdownProvider value={value}>
      <A2UIMarkdownRenderer content={content} messageId="m1" />
    </A2UIMarkdownProvider>
  );
}

function renderMd(content: string, value: A2UIMarkdownConfig = config) {
  return render(tree(content, value));
}

const create = (id = "s") =>
  `{"version":"v0.9","createSurface":{"surfaceId":"${id}","catalogId":"${BASIC_ID}"}}`;

const buttonFence =
  "```a2ui\n" +
  `${create()}\n` +
  `{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Button","child":"lbl","action":{"event":{"name":"choose_plan","context":{"message":"Pick Team"}}}},{"id":"lbl","component":"Text","text":"Choose"}]}}\n` +
  "```";

describe("A2UIMarkdownRenderer", () => {
  it("renders prose and a closed fence as a surface", async () => {
    renderMd(
      `Hello **world**\n\n\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"Painted"}]}}\n\`\`\`\n\nBye`,
    );
    expect(await screen.findByText("Painted")).toBeTruthy();
    expect(screen.getByText("world")).toBeTruthy();
    expect(screen.getByText("Bye")).toBeTruthy();
    expect(
      document.querySelector("[data-a2ui-markdown-surface='s']"),
    ).not.toBeNull();
  });

  it("paints a complete component before the fence closes", async () => {
    renderMd(
      `\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Text","text":"Early"},{"id":"late","compo`,
    );
    expect(await screen.findByText("Early")).toBeTruthy();
  });

  it("shows the building skeleton before the root component is complete", () => {
    renderMd(
      `\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","comp`,
    );
    expect(screen.getByText(/Building interface/i)).toBeTruthy();
  });

  it("drops the building skeleton once the surface has painted", async () => {
    renderMd(
      `\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"Done"}]}}\n\`\`\``,
    );
    await waitFor(() =>
      expect(screen.queryByText(/Building interface/i)).toBeNull(),
    );
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("keeps painted components when the stream stops mid-fence", async () => {
    const partial = `\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"Kept"},{"id":"x","comp`;
    const { rerender } = renderMd(partial);
    expect(await screen.findByText("Kept")).toBeTruthy();
    rerender(tree(partial));
    expect(screen.getByText("Kept")).toBeTruthy();
    expect(screen.queryByText(/Couldn't generate/i)).toBeNull();
  });

  it("later fence with same surfaceId updates in place", async () => {
    renderMd(
      `\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Text","text":"One"}]}}\n\`\`\`\nmid\n\`\`\`a2ui\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Column","children":["t","u"]},{"id":"u","component":"Text","text":"Two"}]}}\n\`\`\``,
    );
    expect(await screen.findByText("Two")).toBeTruthy();
    expect(screen.getByText("One")).toBeTruthy();
    expect(
      document.querySelectorAll("[data-a2ui-markdown-surface]").length,
    ).toBe(1);
  });

  it("synthesizes createSurface when the model omits it", async () => {
    renderMd(
      `\`\`\`a2ui\n{"updateComponents":{"components":[{"id":"root","component":"Text","text":"NoCreate"}]}}\n\`\`\``,
    );
    expect(await screen.findByText("NoCreate")).toBeTruthy();
    expect(
      document.querySelector("[data-a2ui-markdown-surface='m1-0']"),
    ).not.toBeNull();
  });

  it("shows the failure state for a closed fence with no valid surface", async () => {
    renderMd("```a2ui\nthis is not json\n```");
    expect(await screen.findByText(/Couldn't generate/i)).toBeTruthy();
  });

  it("renders nothing for fences when no markdown config is provided", () => {
    render(<A2UIMarkdownRenderer content={buttonFence} messageId="m1" />);
    expect(document.querySelector("[data-a2ui-markdown-surface]")).toBeNull();
  });
});

describe("A2UIMarkdownSurface actions", () => {
  async function clickChoose(value: A2UIMarkdownConfig) {
    renderMd(buttonFence, value);
    const button = await screen.findByRole("button", { name: "Choose" });
    await act(async () => {
      fireEvent.click(button);
    });
  }

  it("sends the action as a visible user message", async () => {
    await clickChoose(config);
    await waitFor(() =>
      expect(mocks.agent.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ role: "user", content: "Pick Team" }),
      ),
    );
    expect(mocks.copilotkit.runAgent).toHaveBeenCalledWith({
      agent: mocks.agent,
    });
    expect(mocks.copilotkit.setProperties).not.toHaveBeenCalled();
  });

  it("does not send when the interceptor returns null", async () => {
    const onAction = vi.fn(() => null);
    await clickChoose({ ...config, onAction });
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    expect(mocks.agent.addMessage).not.toHaveBeenCalled();
    expect(mocks.copilotkit.runAgent).not.toHaveBeenCalled();
  });

  it("sends the action returned by the interceptor", async () => {
    const onAction = vi.fn((action) => ({
      ...action,
      context: { message: "Rewritten" },
    }));
    await clickChoose({ ...config, onAction });
    await waitFor(() =>
      expect(mocks.agent.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Rewritten" }),
      ),
    );
    expect(mocks.agent.addMessage).toHaveBeenCalledTimes(1);
  });

  it("uses the legacy forwarding path when actionMode is legacy", async () => {
    await clickChoose({ ...config, actionMode: "legacy" });
    await waitFor(() => expect(mocks.copilotkit.runAgent).toHaveBeenCalled());
    expect(mocks.copilotkit.setProperties).toHaveBeenCalledWith(
      expect.objectContaining({ a2uiAction: expect.anything() }),
    );
    expect(mocks.agent.addMessage).not.toHaveBeenCalled();
  });
});
