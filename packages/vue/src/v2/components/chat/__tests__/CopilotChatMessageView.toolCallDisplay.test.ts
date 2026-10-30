import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import type { Ref } from "vue";
import { fireEvent, render, screen, within } from "@testing-library/vue";
import { z } from "zod";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { defineToolCallRenderer } from "../../../types";
import type { VueToolCallRenderer } from "../../../types";
import { useDefaultRenderTool } from "../../../hooks/use-default-render-tool";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotChatToolCallsView from "../CopilotChatToolCallsView.vue";
import {
  getToolCallLayouts,
  getToolCallRendererNames,
} from "../tool-call-layout";
import type { CopilotChatToolCallDisplay } from "../tool-call-layout";

// Ported from React's CopilotChatMessageView.toolCallDisplay tests. The
// "turn" display is not in Vue, so its tests are left out.

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
  render: () => h("div", { "data-testid": "weather-card" }, "Weather"),
});

const names = {
  named: new Set(["weather"]),
  groupedNames: new Set<string>(),
  wildcard: true,
  wildcardGroups: true,
};

interface ViewState {
  messages: Ref<Message[]>;
  isRunning: Ref<boolean>;
  toolCallDisplay: Ref<CopilotChatToolCallDisplay | undefined>;
}

/**
 * Renders a message view inside the providers. Without `renderers`, the
 * built-in card (`useDefaultRenderTool()`) draws every call but `weather`.
 */
function renderView(
  messages: Message[],
  props: {
    isRunning?: boolean;
    toolCallDisplay?: CopilotChatToolCallDisplay;
  } = {},
  renderers?: VueToolCallRenderer<unknown>[],
  slots: Record<string, (props: any) => unknown> = {},
) {
  const state: ViewState = {
    messages: ref(messages),
    isRunning: ref(props.isRunning ?? false),
    toolCallDisplay: ref(props.toolCallDisplay),
  };
  const Harness = defineComponent({
    setup() {
      if (!renderers) useDefaultRenderTool();
      return () =>
        h(
          CopilotChatMessageView,
          {
            messages: state.messages.value,
            isRunning: state.isRunning.value,
            toolCallDisplay: state.toolCallDisplay.value,
          },
          slots,
        );
    },
  });
  const rendered = render(CopilotKitProvider, {
    props: { renderToolCalls: renderers ?? [weather] },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "tool-call-display" },
          { default: () => h(Harness) },
        ),
    },
  });
  return { ...rendered, state };
}

const firstButton = (element: HTMLElement) =>
  within(element).getAllByRole("button")[0]!;

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

describe("getToolCallRendererNames", () => {
  const renderers = [
    { name: "*", group: true },
    { name: "search", group: true },
  ];

  it("reads the renderers' group opt-in", () => {
    const result = getToolCallRendererNames(renderers);
    expect([...result.groupedNames]).toEqual(["search"]);
    expect(result.wildcardGroups).toBe(true);
  });

  it("never groups calls a tool-call slot draws", () => {
    const named = getToolCallRendererNames(renderers, ["tool-call-search"]);
    expect(named.named.has("search")).toBe(true);
    expect(named.groupedNames.has("search")).toBe(false);
    expect(named.wildcardGroups).toBe(true);

    const wildcard = getToolCallRendererNames(renderers, ["tool-call"]);
    expect(wildcard.groupedNames.size).toBe(0);
    expect(wildcard.wildcardGroups).toBe(false);
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

  it("groups calls into one collapsed card by default", async () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-appearance")).toBe("card");
    // The header comes first; the rows (closed, so inert) follow it.
    const toggle = firstButton(group);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(
      group.querySelector(".cpk-collapsible")!.id,
    );
    expect(toggle.textContent).toContain("Used 2 tools");
    expect(toggle.textContent).toContain("1 failed");

    await fireEvent.click(toggle);
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

  it("draws a lone call in the same card a group uses", async () => {
    const { state } = renderView([question, callMessage("a")], {
      isRunning: true,
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    const toggle = firstButton(group);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("Running run_command");
    // Nothing has finished yet, so there's no count.
    expect(toggle.textContent).not.toContain("done");

    state.messages.value = [question, callMessage("a"), result("a")];
    state.isRunning.value = false;
    await nextTick();
    expect(toggle.textContent).toContain("Used 1 tool");
    expect(toggle.textContent).toContain("Done");
  });

  it("draws a lone call as the top card of a stack", () => {
    renderView([question, callMessage("a"), result("a")], {
      toolCallDisplay: "stacked",
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    const toggle = firstButton(group);
    expect(toggle.textContent).toContain("run_command");
    expect(toggle.textContent).toContain("1 call");
    // The status icon is decorative; screen readers get the status as text.
    expect(within(toggle).getByText("Done").classList).toContain(
      "cpk-tool-call-group-stack-status",
    );
  });

  it("announces a closed stack's status as it changes", async () => {
    const { state } = renderView([question, callMessage("a")], {
      toolCallDisplay: "stacked",
      isRunning: true,
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    const live = group.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("run_command: Running");

    state.messages.value = [question, callMessage("a"), result("a")];
    state.isRunning.value = false;
    await nextTick();
    // Same region, new text: that's what gets announced.
    expect(group.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live.textContent).toBe("run_command: Done");
  });

  it("opens a stack into the same compact cards, with Collapse", async () => {
    renderView(burst, { toolCallDisplay: "stacked" });
    const group = screen.getByTestId("copilot-tool-call-group");
    await fireEvent.click(firstButton(group));
    expect(within(group).getByText("Collapse")).toBeTruthy();
    const statuses = within(group).getAllByTestId("copilot-tool-render-status");
    expect(statuses).toHaveLength(2);
    // Compact rows, not the standalone card with its status badge.
    for (const status of statuses) {
      expect(status.classList).toContain("cpk-tool-call-row-status");
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

  it("draws a finished lone call in line as its row, without a toggle", () => {
    renderView([question, callMessage("a"), result("a")], {
      toolCallDisplay: "line",
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.classList).toContain("cpk-tool-call-group-single");
    expect(
      within(group).getByTestId("copilot-tool-render").classList,
    ).toContain("cpk-tool-call-row-line");
  });

  it("gives every call its own card with separate", () => {
    renderView(burst, { toolCallDisplay: "separate" });
    expect(screen.queryByTestId("copilot-tool-call-group")).toBeNull();
    const cards = screen.getAllByTestId("copilot-tool-render");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.classList).toContain("cpk-default-tool-call");
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

  it("keeps calls a tool-call slot draws on their own", () => {
    renderView([question, callMessage("a"), callMessage("b")], {}, undefined, {
      "tool-call-run_command": ({ name }: { name: string }) =>
        h("div", { "data-testid": "slot-call" }, name),
    });
    expect(screen.queryByTestId("copilot-tool-call-group")).toBeNull();
    expect(screen.getAllByTestId("slot-call")).toHaveLength(2);
  });

  it("lets the tool-calls-group slot replace a group", () => {
    renderView(burst, {}, undefined, {
      "tool-calls-group": ({
        calls,
        appearance,
        renderCall,
      }: {
        calls: { toolCall: { id: string } }[];
        appearance: string;
        renderCall: (call: unknown) => unknown;
      }) =>
        h(
          "section",
          { "data-testid": "custom-group", "data-appearance": appearance },
          [`${calls.length} calls`, ...calls.map((call) => renderCall(call))],
        ),
    });
    expect(screen.queryByTestId("copilot-tool-call-group")).toBeNull();
    const group = screen.getByTestId("custom-group");
    expect(group.getAttribute("data-appearance")).toBe("card");
    expect(group.textContent).toContain("2 calls");
    // Calls drawn outside a group get the standalone card.
    expect(within(group).getAllByTestId("copilot-tool-render")).toHaveLength(2);
  });

  it("makes a closed group's rows inert", async () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    const body = group.querySelector("[id]")!;
    expect(body.hasAttribute("inert")).toBe(true);
    await fireEvent.click(firstButton(group));
    expect(body.hasAttribute("inert")).toBe(false);
  });

  it("leaves calls drawn by a custom catch-all on their own unless it opts in", () => {
    const draw = ({ name }: { name: string }) =>
      h("div", { "data-testid": "custom-call" }, name);
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

  it("tucks a single opted-in call into a closed group too", async () => {
    const draw = ({ name }: { name: string }) =>
      h("div", { "data-testid": "custom-call" }, name);
    const grouped = defineToolCallRenderer({
      name: "*",
      render: draw,
      group: true,
    });
    const messages = [question, callMessage("a"), result("a")];

    // Grouped: a closed "Used 1 tool" card, like a bigger group.
    const { unmount } = renderView(messages, {}, [grouped]);
    const toggle = firstButton(screen.getByTestId("copilot-tool-call-group"));
    expect(toggle.textContent).toContain("Used 1 tool");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    unmount();

    // Stacked: the call renders once the stack is opened.
    renderView(messages, { toolCallDisplay: "stacked" }, [grouped]);
    expect(screen.queryByTestId("custom-call")).toBeNull();
    await fireEvent.click(
      firstButton(screen.getByTestId("copilot-tool-call-group")),
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
    const header = firstButton(group);
    expect(header.textContent).toContain("1 failed");
    expect(header.textContent).not.toContain("Done");
  });

  it("marks a failed row inside an open group", async () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    await fireEvent.click(firstButton(group));
    const rows = within(group).getAllByTestId("copilot-tool-render-status");
    expect(rows.map((row) => row.textContent)).toEqual(["Done", "Failed"]);
  });

  it("keeps keyboard focus on the stack's toggle when it opens and closes", async () => {
    renderView(burst, { toolCallDisplay: "stacked" });
    const toggle = firstButton(screen.getByTestId("copilot-tool-call-group"));
    toggle.focus();

    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggle);
    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("opens a row to its arguments and result", async () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    await fireEvent.click(firstButton(group));
    const row = within(group).getAllByTestId("copilot-tool-render")[0]!;
    const rowToggle = within(row).getByRole("button");
    const details = document.getElementById(
      rowToggle.getAttribute("aria-controls")!,
    )!;
    expect(details.hasAttribute("inert")).toBe(true);
    await fireEvent.click(rowToggle);
    expect(rowToggle.getAttribute("aria-expanded")).toBe("true");
    expect(details.hasAttribute("inert")).toBe(false);
    expect(details.textContent).toContain("Arguments");
    expect(details.textContent).toContain("cmd a");
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
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return () =>
          h(CopilotChatToolCallsView, { message, messages: [result("a")] });
      },
    });
    render(CopilotKitProvider, { slots: { default: () => h(Harness) } });
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-state")).toBe("running");
    expect(group.textContent).toContain("Running run_command");
  });

  it("gives every call its own card with display separate", () => {
    const message: AssistantMessage = {
      id: "standalone",
      role: "assistant",
      content: "",
      toolCalls: [
        ...callMessage("a").toolCalls!,
        ...callMessage("b").toolCalls!,
      ],
    };
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return () =>
          h(CopilotChatToolCallsView, {
            message,
            messages: [],
            display: "separate",
          });
      },
    });
    render(CopilotKitProvider, { slots: { default: () => h(Harness) } });
    expect(screen.queryByTestId("copilot-tool-call-group")).toBeNull();
    expect(screen.getAllByTestId("copilot-tool-render")).toHaveLength(2);
  });
});
