import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { z } from "zod";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotChatToolCallsView } from "../CopilotChatToolCallsView";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { WildcardToolCallRender } from "../../WildcardToolCallRender";
import { defineToolCallRenderer } from "../../../types";
import { getToolCallLayouts, getTurnWork } from "../tool-call-layout";

const question: Message = { id: "u1", role: "user", content: "Why?" };

const callMessage = (id: string, name = "run_command"): AssistantMessage => ({
  id: `m-${id}`,
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify({ command: `cmd ${id}` }) },
    },
  ],
});

const result = (id: string, error?: string): ToolMessage => ({
  id: `r-${id}`,
  role: "tool",
  toolCallId: id,
  content: "ok",
  ...(error ? { error } : {}),
});

const say = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
});

const weather = defineToolCallRenderer({
  name: "weather",
  args: z.object({}),
  render: () => <div data-testid="weather-card">Weather</div>,
});

const names = {
  named: new Set(["weather"]),
  groupedNames: new Set<string>(),
  wildcard: true,
  wildcardGroups: true,
};

const view = (
  messages: Message[],
  props: Partial<React.ComponentProps<typeof CopilotChatMessageView>> = {},
  renderers: React.ComponentProps<
    typeof CopilotKitProvider
  >["renderToolCalls"] = [weather, WildcardToolCallRender],
) => (
  <CopilotKitProvider renderToolCalls={renderers}>
    <CopilotChatConfigurationProvider threadId="tool-call-display">
      <CopilotChatMessageView messages={messages} {...props} />
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const renderView = (...args: Parameters<typeof view>) => render(view(...args));

describe("getToolCallLayouts", () => {
  it("groups calls made in a row across messages, owned by the first", () => {
    const messages = [
      question,
      callMessage("a"),
      result("a"),
      callMessage("b"),
      result("b"),
    ];
    const layouts = getToolCallLayouts(messages, messages, names);

    const first = layouts.get("m-a")!.segments;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "group", trailing: true });
    expect(
      first[0]!.kind === "group" && first[0]!.calls.map((c) => c.toolCall.id),
    ).toEqual(["a", "b"]);
    expect(layouts.get("m-b")!.segments).toEqual([]);
  });

  it("starts a new group after text or a call with its own renderer", () => {
    const messages = [
      question,
      callMessage("a"),
      say("t", "Checking more."),
      callMessage("b"),
      callMessage("w", "weather"),
      callMessage("c"),
    ];
    const layouts = getToolCallLayouts(messages, messages, names);
    const kinds = ["m-a", "m-b", "m-w", "m-c"].map((id) =>
      layouts.get(id)!.segments.map((segment) => segment.kind),
    );
    expect(kinds).toEqual([["group"], ["group"], ["call"], ["group"]]);
  });

  it("changes its signature when a result arrives for a call it holds", () => {
    const before = [question, callMessage("a"), callMessage("b")];
    const after = [...before, result("b")];
    const signature = (messages: Message[]) =>
      getToolCallLayouts(messages, messages, names).get("m-a")!.signature;
    expect(signature(after)).not.toBe(signature(before));
  });
});

describe("getTurnWork", () => {
  it("treats everything up to the last call as work, and the rest as the reply", () => {
    const messages = [
      question,
      say("t1", "Looking."),
      callMessage("a"),
      result("a"),
      say("t2", "The answer."),
    ];
    const layouts = getToolCallLayouts(messages, messages, names);
    const turn = getTurnWork(messages, layouts).get("u1")!;
    expect([...turn.workMessageIds]).toEqual(["t1", "m-a"]);
    expect(turn.firstMessageId).toBe("t1");
    expect(turn.calls).toHaveLength(1);
  });
});

describe("CopilotChatMessageView toolCallDisplay", () => {
  const burst = [
    question,
    callMessage("a"),
    result("a"),
    callMessage("b"),
    result("b", "boom"),
    say("t", "Done."),
  ];

  it("groups calls into one collapsed card by default", () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-appearance")).toBe("card");
    // The header comes first; the rows (closed, so inert) follow it.
    const toggle = within(group).getAllByRole("button")[0]!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("Used 2 tools");
    expect(toggle.textContent).toContain("1 failed");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(group).getAllByTestId("copilot-tool-render")).toHaveLength(2);
  });

  it("names the running call while the group is still going", () => {
    renderView([question, callMessage("a"), result("a"), callMessage("b")], {
      isRunning: true,
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-state")).toBe("running");
    expect(group.textContent).toContain("Running run_command");
    expect(group.textContent).toContain("1 done");
  });

  it("draws a lone call in the same card a group uses", () => {
    const { rerender } = renderView([question, callMessage("a")], {
      isRunning: true,
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    const toggle = within(group).getAllByRole("button")[0]!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("Running run_command");
    // Nothing has finished yet, so there's no count.
    expect(toggle.textContent).not.toContain("done");

    rerender(view([question, callMessage("a"), result("a")]));
    expect(toggle.textContent).toContain("Used 1 tool");
    expect(toggle.textContent).toContain("Done");
  });

  it("draws a lone call as the top card of a stack", () => {
    renderView([question, callMessage("a"), result("a")], {
      toolCallDisplay: "stacked",
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    const toggle = within(group).getAllByRole("button")[0]!;
    expect(toggle.textContent).toContain("run_command");
    expect(toggle.textContent).toContain("1 call");
    // The status icon is decorative; screen readers get the status as text.
    expect(within(toggle).getByText("Done").className).toContain("sr-only");
  });

  it("announces a closed stack's status as it changes", () => {
    const { rerender } = renderView([question, callMessage("a")], {
      toolCallDisplay: "stacked",
      isRunning: true,
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    const live = group.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("run_command: Running");

    rerender(
      view([question, callMessage("a"), result("a")], {
        toolCallDisplay: "stacked",
      }),
    );
    // Same region, new text: that's what gets announced.
    expect(group.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live.textContent).toBe("run_command: Done");
  });

  it("opens a stack into the same compact cards, with Collapse", () => {
    renderView(burst, { toolCallDisplay: "stacked" });
    const group = screen.getByTestId("copilot-tool-call-group");
    fireEvent.click(within(group).getAllByRole("button")[0]!);
    expect(within(group).getByText("Collapse")).toBeTruthy();
    const statuses = within(group).getAllByTestId("copilot-tool-render-status");
    expect(statuses).toHaveLength(2);
    // Compact rows, not the standalone card with its status badge.
    for (const status of statuses) {
      expect(status.className).toContain("sr-only");
    }
  });

  it.each([
    ["line", "line"],
    ["stacked", "stack"],
  ] as const)("draws %s groups", (display, appearance) => {
    renderView(burst, { toolCallDisplay: display });
    expect(
      screen
        .getByTestId("copilot-tool-call-group")
        .getAttribute("data-appearance"),
    ).toBe(appearance);
  });

  it("gives every call its own card with separate", () => {
    renderView(burst, { toolCallDisplay: "separate" });
    expect(screen.queryByTestId("copilot-tool-call-group")).toBeNull();
    expect(screen.getAllByTestId("copilot-tool-render")).toHaveLength(2);
  });

  it("keeps calls with their own renderer visible and outside the group", () => {
    renderView([
      question,
      callMessage("a"),
      callMessage("w", "weather"),
      callMessage("b"),
    ]);
    expect(screen.getByTestId("weather-card")).toBeDefined();
    expect(screen.getAllByTestId("copilot-tool-call-group")).toHaveLength(2);
  });

  it("folds a finished reply's work into the summary with turn", () => {
    renderView([question, say("t1", "Looking."), ...burst.slice(1)], {
      toolCallDisplay: "turn",
    });
    const summary = screen.getByTestId("copilot-work-summary");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    // No timing for a reply this client didn't watch: it counts the tools.
    expect(summary.textContent).toContain("Used 2 tools");
    expect(
      document.querySelector('[data-work-text="narration"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-work-text="reply"]')).not.toBeNull();

    fireEvent.click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows Working while the latest reply runs with turn", () => {
    renderView([question], { toolCallDisplay: "turn", isRunning: true });
    const summary = screen.getByTestId("copilot-work-summary");
    expect(summary.getAttribute("data-state")).toBe("working");
    expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
  });

  it("makes a closed group's rows inert", () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    const body = group.querySelector("[id]")!;
    expect(body.hasAttribute("inert")).toBe(true);
    fireEvent.click(within(group).getAllByRole("button")[0]!);
    expect(body.hasAttribute("inert")).toBe(false);
  });

  it("keeps a reasoning message mounted when a later call makes it work", () => {
    const reasoning: Message = {
      id: "r1",
      role: "reasoning",
      content: "Thinking about it.",
    };
    const { rerender } = renderView([question, reasoning], {
      toolCallDisplay: "turn",
      isRunning: true,
    });
    const node = screen.getByText("Thinking about it.");

    rerender(
      view([question, reasoning, callMessage("a")], {
        toolCallDisplay: "turn",
        isRunning: true,
      }),
    );
    expect(screen.getByText("Thinking about it.")).toBe(node);
  });

  it("leaves calls drawn by a custom catch-all on their own unless it opts in", () => {
    const draw = ({ name }: { name: string }) => (
      <div data-testid="custom-call">{name}</div>
    );
    const quiet = defineToolCallRenderer({ name: "*", render: draw });
    const messages = [question, callMessage("a"), callMessage("b")];

    const { unmount } = renderView(messages, {}, [quiet]);
    expect(screen.queryByTestId("copilot-tool-call-group")).toBeNull();
    expect(screen.getAllByTestId("custom-call")).toHaveLength(2);
    unmount();

    renderView(messages, {}, [
      defineToolCallRenderer({ name: "*", render: draw, group: true }),
    ]);
    expect(screen.getByTestId("copilot-tool-call-group")).toBeDefined();
  });

  it("tucks a single opted-in call into a closed group too", () => {
    const draw = ({ name }: { name: string }) => (
      <div data-testid="custom-call">{name}</div>
    );
    const grouped = defineToolCallRenderer({
      name: "*",
      render: draw,
      group: true,
    });
    const messages = [question, callMessage("a"), result("a")];

    // Grouped: a closed "Used 1 tool" card, like a bigger group.
    const { unmount } = renderView(messages, {}, [grouped]);
    const toggle = within(
      screen.getByTestId("copilot-tool-call-group"),
    ).getAllByRole("button")[0]!;
    expect(toggle.textContent).toContain("Used 1 tool");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    unmount();

    // Stacked: the call renders once the stack is opened.
    renderView(messages, { toolCallDisplay: "stacked" }, [grouped]);
    expect(screen.queryByTestId("custom-call")).toBeNull();
    fireEvent.click(
      within(screen.getByTestId("copilot-tool-call-group")).getAllByRole(
        "button",
      )[0]!,
    );
    expect(screen.getByTestId("custom-call").textContent).toBe("run_command");
  });

  it("shows a group the run left unfinished as stopped, not running", () => {
    renderView([question, callMessage("a"), result("a"), callMessage("b")], {
      isRunning: false,
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-state")).toBe("stopped");
    expect(group.textContent).not.toContain("Running");
    expect(group.textContent).toContain("Stopped");
  });

  it("says how many calls failed instead of Done", () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-state")).toBe("failed");
    const header = within(group).getAllByRole("button")[0]!;
    expect(header.textContent).toContain("1 failed");
    expect(header.textContent).not.toContain("Done");
  });

  it("keeps keyboard focus on the stack's toggle when it opens and closes", () => {
    renderView(burst, { toolCallDisplay: "stacked" });
    const toggle = within(
      screen.getByTestId("copilot-tool-call-group"),
    ).getAllByRole("button")[0]!;
    toggle.focus();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps the answer visible in turn when it shares a message with a call", () => {
    const answer: AssistantMessage = {
      ...callMessage("chart", "show_chart"),
      content: "Revenue grew 12%.",
    };
    renderView([question, say("t1", "Looking."), answer], {
      toolCallDisplay: "turn",
    });
    expect(
      document
        .querySelector('[data-message-id="t1"] [data-work-text]')!
        .getAttribute("data-work-text"),
    ).toBe("narration");
    expect(
      document
        .querySelector(`[data-message-id="${answer.id}"] [data-work-text]`)!
        .getAttribute("data-work-text"),
    ).toBe("reply");
  });
});

describe("CopilotChatWorkSummary timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  const finished = [question, callMessage("a"), result("a"), say("t", "Done.")];
  const summary = () => screen.getByTestId("copilot-work-summary").textContent;

  it("ticks while working and reports the total once done", () => {
    const { rerender } = renderView([question], {
      toolCallDisplay: "turn",
      isRunning: true,
    });
    act(() => vi.advanceTimersByTime(125_000));
    expect(summary()).toContain("Working2m 5s");

    vi.setSystemTime(65_000 + 60_000);
    rerender(view(finished, { toolCallDisplay: "turn", isRunning: false }));
    expect(summary()).toContain("Worked for 2m 5s");
  });

  it("reports a 65-second turn as 1m 5s", () => {
    const { rerender } = renderView([question], {
      toolCallDisplay: "turn",
      isRunning: true,
    });
    vi.setSystemTime(65_000);
    rerender(view(finished, { toolCallDisplay: "turn", isRunning: false }));
    expect(summary()).toContain("Worked for 1m 5s");
  });

  it("leaves out time spent waiting between runs", () => {
    const { rerender } = renderView([question], {
      toolCallDisplay: "turn",
      isRunning: true,
    });
    vi.setSystemTime(5_000);
    rerender(view(finished, { toolCallDisplay: "turn", isRunning: false }));

    vi.setSystemTime(185_000); // three minutes waiting on an approval
    rerender(view(finished, { toolCallDisplay: "turn", isRunning: true }));
    vi.setSystemTime(190_000);
    rerender(view(finished, { toolCallDisplay: "turn", isRunning: false }));
    expect(summary()).toContain("Worked for 10s");
  });
});

describe("CopilotChatToolCallsView on its own", () => {
  it("shows a call without a result as running, with no run state to say otherwise", () => {
    const message: AssistantMessage = {
      id: "standalone",
      role: "assistant",
      content: "",
      toolCalls: [
        ...callMessage("a").toolCalls!,
        ...callMessage("b").toolCalls!,
      ],
    };
    render(
      <CopilotKitProvider renderToolCalls={[WildcardToolCallRender]}>
        <CopilotChatToolCallsView message={message} messages={[result("a")]} />
      </CopilotKitProvider>,
    );
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-state")).toBe("running");
    expect(group.textContent).toContain("Running run_command");
  });
});
