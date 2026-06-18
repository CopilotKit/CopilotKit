import { describe, it, expect, vi } from "vitest";
import {
  renderToIR,
  type BotNode,
  type InteractionContext,
  type ClickHandler,
} from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";
import { ConfirmWrite } from "../confirm-write.js";

/** Children of an IR node as an array (empty if none). */
function childNodes(node: BotNode): BotNode[] {
  const children = node.props?.children;
  if (Array.isArray(children)) return children as BotNode[];
  if (
    children &&
    typeof children === "object" &&
    "type" in (children as object)
  ) {
    return [children as BotNode];
  }
  return [];
}

/** Concatenate the text of all descendant `text` nodes (depth-first). */
function collectText(node: BotNode): string {
  if (node.type === "text") return String(node.props?.value ?? "");
  return childNodes(node).map(collectText).join("");
}

/** Walk the whole tree to find the first node of a given intrinsic type. */
function findByType(nodes: BotNode[], type: string): BotNode | undefined {
  for (const n of nodes) {
    if (n.type === type) return n;
    const hit = findByType(childNodes(n), type);
    if (hit) return hit;
  }
  return undefined;
}

/** All button nodes in the tree. */
function findButtons(nodes: BotNode[]): BotNode[] {
  const out: BotNode[] = [];
  for (const n of nodes) {
    if (n.type === "button") out.push(n);
    out.push(...findButtons(childNodes(n)));
  }
  return out;
}

function buttonByText(ir: BotNode[], text: string): BotNode {
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

  it("approve onClick updates the picker in place to the resolved (green) state", async () => {
    const ir = renderToIR(
      <ConfirmWrite action="Create Linear issue" detail="CPK-9: ..." />,
    );
    const create = buttonByText(ir, "Create");

    // `value` survives on the button props — that's what awaitChoice resolves to.
    expect(create.props.value).toEqual({ confirmed: true });

    const update = vi.fn(async () => ({ id: "m1" }));
    const ctx = {
      thread: { update },
      message: { ref: { id: "m1" } },
    } as unknown as InteractionContext;

    await (create.props.onClick as ClickHandler)(ctx);

    expect(update).toHaveBeenCalledTimes(1);
    const [ref, renderable] = update.mock.calls[0] as unknown as [
      { id: string },
      Parameters<typeof renderToIR>[0],
    ];
    expect(ref).toEqual({ id: "m1" });

    const { blocks, accent } = renderSlackMessage(renderToIR(renderable));
    expect(accent).toBe("#27AE60");
    const header = blocks.find((b) => b.type === "header") as
      | { text: { text: string } }
      | undefined;
    expect(header?.text.text).toContain("Create Linear issue");
    const context = blocks.find((b) => b.type === "context") as
      | { elements: { text: string }[] }
      | undefined;
    expect(context?.elements[0]?.text).toContain("Approved");
  });

  it("cancel onClick updates the picker in place to the declined (red) state", async () => {
    const ir = renderToIR(
      <ConfirmWrite action="Create Linear issue" detail="CPK-9: ..." />,
    );
    const cancel = buttonByText(ir, "Cancel");

    expect(cancel.props.value).toEqual({ confirmed: false });

    const update = vi.fn(async () => ({ id: "m1" }));
    const ctx = {
      thread: { update },
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
});
