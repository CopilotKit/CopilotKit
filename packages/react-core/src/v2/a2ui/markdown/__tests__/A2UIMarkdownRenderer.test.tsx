import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  basicCatalog,
  standardCatalog,
  STANDARD_CATALOG_ID,
} from "@copilotkit/a2ui-renderer";
import type { Theme } from "@copilotkit/a2ui-renderer";
import { A2UIMarkdownProvider } from "../A2UIMarkdownContext";
import type { A2UIMarkdownConfig } from "../A2UIMarkdownContext";
import { A2UIMarkdownRenderer } from "../A2UIMarkdownRenderer";

const mocks = vi.hoisted(() => {
  const agent = { addMessage: vi.fn(), isRunning: false };
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  mocks.agent.isRunning = false;
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

  it("renders no placeholder before the root component is complete", () => {
    renderMd(
      `\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","comp`,
    );
    expect(screen.queryByText(/Building interface/i)).toBeNull();
    // Only the offscreen (aria-hidden) processing container is mounted.
    const wrapper = document.querySelector("[data-a2ui-markdown-surface]")!;
    const visible = Array.from(wrapper.children).filter(
      (el) => el.getAttribute("aria-hidden") !== "true",
    );
    expect(visible).toEqual([]);
  });

  it("renders an app-provided loadingComponent before the root is complete", () => {
    render(
      <A2UIMarkdownProvider
        value={{ ...config, loadingComponent: () => <div>Custom loader</div> }}
      >
        <A2UIMarkdownRenderer
          content={`\`\`\`a2ui\n${create()}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","comp`}
          messageId="m1"
        />
      </A2UIMarkdownProvider>,
    );
    expect(screen.getByText("Custom loader")).toBeTruthy();
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

const uc = (components: unknown[], id = "s") =>
  JSON.stringify({
    version: "v0.9",
    updateComponents: { surfaceId: id, components },
  });
const fence = (...lines: string[]) => "```a2ui\n" + lines.join("\n") + "\n```";

describe("A2UIMarkdownRenderer same-id fences", () => {
  it("does not fail when two fences for one surface each send createSurface", async () => {
    renderMd(
      fence(
        create(),
        uc([
          { id: "root", component: "Column", children: ["t"] },
          { id: "t", component: "Text", text: "One" },
        ]),
      ) +
        "\nmid\n" +
        fence(
          create(),
          uc([
            { id: "root", component: "Column", children: ["t", "u"] },
            { id: "u", component: "Text", text: "Two" },
          ]),
        ),
    );
    expect(await screen.findByText("Two")).toBeTruthy();
    expect(screen.queryByText(/A2UI render error/)).toBeNull();
  });
});

describe("A2UIMarkdownSurface paint and failure criteria", () => {
  it("paints a path-bound input with no data model and shows no failure card", async () => {
    renderMd(
      fence(
        create(),
        uc([
          { id: "root", component: "Column", children: ["email"] },
          {
            id: "email",
            component: "TextField",
            label: "Email",
            value: { path: "/email" },
          },
        ]),
      ),
    );
    expect(await screen.findByRole("textbox")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText(/Building interface/i)).toBeNull(),
    );
    expect(screen.queryByText(/Couldn't generate/i)).toBeNull();
  });

  it("shows the failure card for a closed fence with only createSurface", async () => {
    renderMd(fence(create()));
    expect(await screen.findByText(/Couldn't generate/i)).toBeTruthy();
  });

  it("shows the failure card for a closed fence whose components have no root", async () => {
    renderMd(fence(create(), uc([{ id: "t", component: "Text", text: "x" }])));
    expect(await screen.findByText(/Couldn't generate/i)).toBeTruthy();
  });
});

describe("A2UIMarkdownSurface action labels and errors", () => {
  const plainButton = fence(
    create(),
    uc([
      {
        id: "root",
        component: "Button",
        child: "lbl",
        action: { event: { name: "choose_plan" } },
      },
      { id: "lbl", component: "Text", text: "Choose" },
    ]),
  );

  async function click() {
    renderMd(plainButton);
    const button = await screen.findByRole("button", { name: "Choose" });
    await act(async () => {
      fireEvent.click(button);
    });
  }

  it("uses the button's visible label when the action has no message", async () => {
    await click();
    await waitFor(() =>
      expect(mocks.agent.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Choose" }),
      ),
    );
  });

  it("logs a failed action instead of leaving the rejection unhandled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.copilotkit.runAgent.mockRejectedValueOnce(new Error("boom"));
    await click();
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[A2UI] action failed",
        expect.any(Error),
      ),
    );
  });

  it("ignores clicks while the agent is running", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.agent.isRunning = true;
    await click();
    await waitFor(() =>
      expect(
        warn.mock.calls.some((args) => String(args[0]).includes("running")),
      ).toBe(true),
    );
    expect(mocks.agent.addMessage).not.toHaveBeenCalled();
    expect(mocks.copilotkit.runAgent).not.toHaveBeenCalled();
  });
});

describe("A2UIMarkdownSurface failure details", () => {
  const bad = "```a2ui\nthis is not json\n```";

  it("shows the raw fence in a collapsed expander outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    renderMd(bad);
    expect(await screen.findByText(/Couldn't generate/i)).toBeTruthy();
    expect(screen.getByText("developer details")).toBeTruthy();
    const details = document.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("this is not json");
  });

  it("hides the expander in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    renderMd(bad);
    expect(await screen.findByText(/Couldn't generate/i)).toBeTruthy();
    expect(screen.queryByText("developer details")).toBeNull();
  });

  it("lets recovery.debugExposure override the default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    renderMd(bad, { ...config, recovery: { debugExposure: "verbose" } });
    expect(await screen.findByText(/Couldn't generate/i)).toBeTruthy();
    expect(document.querySelector("details")?.open).toBe(true);
  });
});

describe("A2UIMarkdownSurface validation at fence close", () => {
  it("still paints a surface with a root and warns about unknown components", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMd(
      fence(
        create(),
        uc([
          { id: "root", component: "Column", children: ["t", "z"] },
          { id: "t", component: "Text", text: "Visible" },
          { id: "z", component: "Bogus" },
        ]),
      ),
    );
    expect(await screen.findByText("Visible")).toBeTruthy();
    expect(screen.queryByText(/Couldn't generate/i)).toBeNull();
    await waitFor(() =>
      expect(
        warn.mock.calls.some((args) =>
          args.map(String).join(" ").includes("'Bogus' is not in the catalog"),
        ),
      ).toBe(true),
    );
  });

  it("lists validation errors in the failure card when there is no root", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMd(fence(create(), uc([{ id: "x", component: "Bogus" }])));
    expect(await screen.findByText(/Couldn't generate/i)).toBeTruthy();
    expect(document.querySelector("details")?.textContent).toContain(
      "Component type 'Bogus' is not in the catalog",
    );
  });

  it("does not warn for a valid surface", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMd(buttonFence);
    expect(await screen.findByRole("button", { name: "Choose" })).toBeTruthy();
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes("[A2UI]")),
    ).toBe(false);
  });
});

describe("A2UIMarkdownSurface cards (standard catalog)", () => {
  const standard: A2UIMarkdownConfig = {
    catalog: standardCatalog,
    catalogId: STANDARD_CATALOG_ID,
    theme: {} as Theme,
    actionMode: "message",
  };
  const cardOf = (text: string) =>
    screen.getByText(text).closest("[data-a2ui-card]") as HTMLElement;

  it("draws a box only around the interactive panel", async () => {
    renderMd(
      fence(
        create(),
        uc([
          { id: "root", component: "Column", children: ["info", "panel"] },
          { id: "info", component: "Card", children: ["it", "tbl"] },
          { id: "it", component: "Title", text: "Breakdown" },
          {
            id: "tbl",
            component: "Table",
            columns: ["Item", "Cost"],
            rows: [["Seats", "$8"]],
          },
          { id: "panel", component: "Card", children: ["pt", "sl"] },
          { id: "pt", component: "Title", text: "Your project" },
          { id: "sl", component: "Slider", min: 1, max: 10, value: 3 },
        ]),
      ),
      standard,
    );
    expect(await screen.findByText("Breakdown")).toBeTruthy();
    const info = cardOf("Breakdown");
    expect(info.getAttribute("data-a2ui-card-variant")).toBe("section");
    expect(info.getAttribute("style")).not.toContain("1px solid");
    const panel = cardOf("Your project");
    expect(panel.getAttribute("style")).toContain("1px solid");
  });

  it("marks and warns about a surface that is only prose", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMd(
      fence(
        create(),
        uc([
          { id: "root", component: "Column", children: ["t", "m"] },
          { id: "t", component: "Title", text: "Summary" },
          { id: "m", component: "Markdown", text: "Just **words**." },
        ]),
      ),
      standard,
    );
    expect(await screen.findByText("Summary")).toBeTruthy();
    const wrapper = document.querySelector("[data-a2ui-markdown-surface='s']")!;
    expect(wrapper.hasAttribute("data-a2ui-prose-only")).toBe(true);
    await waitFor(() =>
      expect(
        warn.mock.calls.some((args) =>
          String(args[0]).includes(
            "[A2UI] surface contains only prose; prefer plain markdown",
          ),
        ),
      ).toBe(true),
    );
  });

  it("does not mark a surface with a table as prose-only", async () => {
    renderMd(
      fence(
        create(),
        uc([
          { id: "root", component: "Column", children: ["t", "tbl"] },
          { id: "t", component: "Title", text: "Costs" },
          { id: "tbl", component: "Table", columns: ["A"], rows: [["1"]] },
        ]),
      ),
      standard,
    );
    expect(await screen.findByText("Costs")).toBeTruthy();
    const wrapper = document.querySelector("[data-a2ui-markdown-surface='s']")!;
    expect(wrapper.hasAttribute("data-a2ui-prose-only")).toBe(false);
  });
});
