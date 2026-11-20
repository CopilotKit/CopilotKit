import { describe, it, expect, vi } from "vitest";
import { renderToIR } from "@copilotkit/channels";
import type {
  ChannelNode,
  InteractionContext,
  ClickHandler,
} from "@copilotkit/channels";
import { renderSlackMessage } from "@copilotkit/channels/slack";
import { ConfirmWrite } from "../confirm-write.js";

/** Children of an IR node as an array (empty if none). */
function childNodes(node: ChannelNode): ChannelNode[] {
  const children = node.props?.children;
  if (Array.isArray(children)) return children as ChannelNode[];
  if (
    children &&
    typeof children === "object" &&
    "type" in (children as object)
  ) {
    return [children as ChannelNode];
  }
  return [];
}

/** Concatenate the text of all descendant `text` nodes (depth-first). */
function collectText(node: ChannelNode): string {
  if (node.type === "text") return String(node.props?.value ?? "");
  return childNodes(node).map(collectText).join("");
}

/** Walk the whole tree to find the first node of a given intrinsic type. */
function findByType(
  nodes: ChannelNode[],
  type: string,
): ChannelNode | undefined {
  for (const n of nodes) {
    if (n.type === type) return n;
    const hit = findByType(childNodes(n), type);
    if (hit) return hit;
  }
  return undefined;
}

/** All button nodes in the tree. */
function findButtons(nodes: ChannelNode[]): ChannelNode[] {
  const out: ChannelNode[] = [];
  for (const n of nodes) {
    if (n.type === "button") out.push(n);
    out.push(...findButtons(childNodes(n)));
  }
  return out;
}

function buttonByText(ir: ChannelNode[], text: string): ChannelNode {
  const btn = findButtons(ir).find((b) => collectText(b) === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn;
}

describe("ConfirmWrite", () => {
  it("renders the pending picker: amber accent, header, detail, lock context, Create/Cancel", () => {
    const ir = renderToIR(
      <ConfirmWrite
        action="Create Linear issue"
        detail="CPK-9: Checkout 500s under load"
      />,
    );
    const { blocks, accent } = renderSlackMessage(ir);

    expect(accent).toBe("#E2B340");

    const header = blocks.find((b) => b.type === "header") as
      | { text: { text: string } }
      | undefined;
    expect(header?.text.text).toContain("Create Linear issue");

    const section = blocks.find((b) => b.type === "section") as
      | { text: { text: string } }
      | undefined;
    expect(section?.text.text).toContain("CPK-9: Checkout 500s under load");

    const context = blocks.find((b) => b.type === "context") as
      | { elements: { text: string }[] }
      | undefined;
    expect(context?.elements[0]?.text).toContain(
      "Nothing is written until you click",
    );
    // "Create" is authored as Markdown bold (`**Create**`) so the IR→mrkdwn
    // transform renders it as Slack bold (`*Create*`), matching the old card.
    expect(context?.elements[0]?.text).toContain("*Create*");
    expect(context?.elements[0]?.text).not.toContain("_Create_");

    const actions = blocks.find((b) => b.type === "actions") as
      | { elements: { text: { text: string } }[] }
      | undefined;
    expect(actions?.elements.map((e) => e.text.text)).toEqual([
      "Create",
      "Cancel",
    ]);
  });

  it("omits the detail section when no detail is given", () => {
    const ir = renderToIR(<ConfirmWrite action="Create Linear issue" />);
    const { blocks } = renderSlackMessage(ir);
    expect(blocks.some((b) => b.type === "section")).toBe(false);
  });

  it("approve walks the card pending -> working -> done", async () => {
    const ir = renderToIR(
      <ConfirmWrite action="Create Linear issue" detail="CPK-9: ..." />,
    );
    const create = buttonByText(ir, "Create");

    expect(create.props.value).toEqual({ confirmed: true });

    const update = vi.fn(async () => ({ id: "m1" }));
    const runAgent = vi.fn(async () => undefined);
    const ctx = {
      thread: { update, runAgent },
      message: { ref: { id: "m1" } },
    } as unknown as InteractionContext;

    await (create.props.onClick as ClickHandler)(ctx);

    expect(update).toHaveBeenCalledTimes(2);

    const render = (call: number) => {
      const [ref, renderable] = update.mock.calls[call] as unknown as [
        { id: string },
        Parameters<typeof renderToIR>[0],
      ];
      expect(ref).toEqual({ id: "m1" });
      return renderSlackMessage(renderToIR(renderable));
    };

    // Working state lands before the agent runs: Discord stops its own button
    // spinner at the ACK, so this is the only sign the click registered.
    const working = render(0);
    expect(working.accent).toBe("#E2B340");
    const workingContext = working.blocks.find((b) => b.type === "context") as
      | { elements: { text: string }[] }
      | undefined;
    expect(workingContext?.elements[0]?.text).toContain("creating now");

    const done = render(1);
    expect(done.accent).toBe("#27AE60");
    const header = done.blocks.find((b) => b.type === "header") as
      | { text: { text: string } }
      | undefined;
    expect(header?.text.text).toContain("Create Linear issue");
    const doneContext = done.blocks.find((b) => b.type === "context") as
      | { elements: { text: string }[] }
      | undefined;
    expect(doneContext?.elements[0]?.text).toContain("Done");
  });

  it("approve shows a failed card when the write throws", async () => {
    const ir = renderToIR(<ConfirmWrite action="Create Linear issue" />);
    const create = buttonByText(ir, "Create");

    const update = vi.fn(async () => ({ id: "m1" }));
    const runAgent = vi.fn(async () => {
      throw new Error("linear write failed");
    });
    const ctx = {
      thread: { update, runAgent },
      message: { ref: { id: "m1" } },
    } as unknown as InteractionContext;

    await (create.props.onClick as ClickHandler)(ctx);

    // The card must not be left claiming it is still working.
    expect(update).toHaveBeenCalledTimes(2);
    const [, renderable] = update.mock.calls[1] as unknown as [
      unknown,
      Parameters<typeof renderToIR>[0],
    ];
    const { accent, blocks } = renderSlackMessage(renderToIR(renderable));
    expect(accent).toBe("#EB5757");
    const context = blocks.find((b) => b.type === "context") as
      | { elements: { text: string }[] }
      | undefined;
    expect(context?.elements[0]?.text).toContain("Failed");
  });

  it("cancel onClick updates the picker in place to the declined (red) state", async () => {
    const ir = renderToIR(
      <ConfirmWrite action="Create Linear issue" detail="CPK-9: ..." />,
    );
    const cancel = buttonByText(ir, "Cancel");

    expect(cancel.props.value).toEqual({ confirmed: false });

    const update = vi.fn(async () => ({ id: "m1" }));
    const runAgent = vi.fn(async () => undefined);
    const ctx = {
      thread: { update, runAgent },
      message: { ref: { id: "m1" } },
    } as unknown as InteractionContext;

    await (cancel.props.onClick as ClickHandler)(ctx);

    expect(update).toHaveBeenCalledTimes(1);
    const [ref, renderable] = update.mock.calls[0] as unknown as [
      { id: string },
      Parameters<typeof renderToIR>[0],
    ];
    expect(ref).toEqual({ id: "m1" });

    const { blocks, accent } = renderSlackMessage(renderToIR(renderable));
    expect(accent).toBe("#EB5757");
    const header = blocks.find((b) => b.type === "header") as
      | { text: { text: string } }
      | undefined;
    expect(header?.text.text).toContain("Create Linear issue");
    const context = blocks.find((b) => b.type === "context") as
      | { elements: { text: string }[] }
      | undefined;
    expect(context?.elements[0]?.text).toContain("Declined");
  });

  it("approve resumes the agent after updating the card", async () => {
    const ir = renderToIR(
      <ConfirmWrite action="Create Linear issue" detail="CPK-9: ..." />,
    );
    const create = buttonByText(ir, "Create");

    const calls: string[] = [];
    const update = vi.fn(async () => {
      calls.push("update");
      return { id: "m1" };
    });
    const runAgent = vi.fn(async () => {
      calls.push("runAgent");
    });
    const ctx = {
      thread: { update, runAgent },
      message: { ref: { id: "m1" } },
    } as unknown as InteractionContext;

    await (create.props.onClick as ClickHandler)(ctx);

    // The card is the user's feedback that the click landed, so it must not
    // wait on a model call.
    expect(calls).toEqual(["update", "runAgent", "update"]);

    const prompt = (
      runAgent.mock.calls[0] as unknown as [{ prompt: string }]
    )[0].prompt;
    expect(prompt).toContain("APPROVED");
    expect(prompt).toContain("Create Linear issue");
    expect(prompt).toContain("CPK-9");
  });

  it("decline updates the card and does not resume the agent", async () => {
    const ir = renderToIR(<ConfirmWrite action="Create Linear issue" />);
    const cancel = buttonByText(ir, "Cancel");

    const update = vi.fn(async () => ({ id: "m1" }));
    const runAgent = vi.fn(async () => undefined);
    const ctx = {
      thread: { update, runAgent },
      message: { ref: { id: "m1" } },
    } as unknown as InteractionContext;

    await (cancel.props.onClick as ClickHandler)(ctx);

    expect(update).toHaveBeenCalledTimes(1);
    expect(runAgent).not.toHaveBeenCalled();
  });
});
