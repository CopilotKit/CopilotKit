import type { ReactNode } from "react";
import { act, render, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { z } from "zod";
import CopilotKitPage from "./page";

const sdk = vi.hoisted(() => ({
  agent: { state: {} as Record<string, unknown>, setState: vi.fn() },
  tools: new Map<
    string,
    {
      name: string;
      handler?: (args: { themeColor: string }) => Promise<unknown>;
      parameters?: z.ZodTypeAny;
      render?: (props: {
        status: string;
        args: Record<string, unknown>;
        result?: string;
      }) => ReactNode;
    }
  >(),
}));
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: sdk.agent }),
  useFrontendTool: (tool: { name: string }) => sdk.tools.set(tool.name, tool),
  CopilotChatConfigurationProvider: ({ children }: { children: ReactNode }) =>
    children,
  CopilotSidebar: () => <aside>Project assistant</aside>,
}));
/** Mount one isolated board with the supplied streamed agent state. */
function setup(state: Record<string, unknown> = {}) {
  sdk.agent = { state, setState: vi.fn() };
  sdk.tools = new Map();
  const view = render(<CopilotKitPage />);
  return { ...view, agent: sdk.agent, tools: sdk.tools };
}

test("a partial streamed board renders valid tasks and safely skips malformed records", () => {
  const view = setup({
    projectName: "Release board",
    users: "malformed streamed users",
    tasks: [
      {
        id: 2,
        name: "Ship the release",
        description: "Check the build",
        status: "todo",
        assignedTo: 1,
      },
      { id: 3, name: "Partial task" },
    ],
  });
  try {
    expect(within(view.container).getByText("Release board")).toBeTruthy();
    expect(within(view.container).getByText("Ship the release")).toBeTruthy();
    expect(within(view.container).queryByText("Partial task")).toBeNull();
    expect(within(view.container).getByText("Team Members")).toBeTruthy();
    expect(view.agent.setState).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

test("an empty agent is seeded once with the initial project board", () => {
  const view = setup();
  try {
    expect(view.agent.setState).toHaveBeenCalledOnce();
    expect(view.agent.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "My Project",
        tasks: expect.arrayContaining([
          expect.objectContaining({ name: "Build the product" }),
        ]),
      }),
    );
    view.rerender(<CopilotKitPage />);
    expect(view.agent.setState).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
  }
});

test("hydrated empty arrays stay empty without reseeding the board", () => {
  const view = setup({
    projectName: "Saved board",
    projectDescription: "Saved description",
    users: [],
    tasks: [],
  });
  try {
    expect(within(view.container).getByText("Saved board")).toBeTruthy();
    expect(within(view.container).queryByText("Build the product")).toBeNull();
    expect(view.agent.setState).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

test("the theme tool updates the board and rejects invalid colors", async () => {
  const view = setup();
  try {
    const tool = view.tools.get("setThemeColor");
    await act(async () => {
      await tool?.handler?.({ themeColor: "#008000" });
    });
    expect(
      view.container
        .querySelector("main")
        ?.style.getPropertyValue("--copilot-kit-primary-color"),
    ).toBe("#008000");
    expect(
      tool?.parameters?.safeParse({ themeColor: "not-a-color" }).success,
    ).toBe(false);
  } finally {
    view.unmount();
  }
});

test("later streamed tasks update their board column without changing saved state", () => {
  const view = setup({ projectName: "Release board", users: [], tasks: [] });
  try {
    view.agent.state = {
      projectName: "Release board",
      users: [],
      tasks: [
        {
          id: 2,
          name: "Verified release",
          description: "All checks passed",
          status: "done",
          assignedTo: 1,
        },
      ],
    };
    view.rerender(<CopilotKitPage />);

    const task = within(view.container).getByText("Verified release");
    const doneColumn = within(view.container).getByText("Done").parentElement
      ?.parentElement;
    expect(doneColumn?.contains(task)).toBe(true);
    expect(view.agent.setState).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});
