import { describe, it, expect } from "vitest";
import { renderToIR, type BotNode } from "@copilotkit/bot-ui";
import { confirmWriteTool } from "../confirm-write-tool.js";

/** A fake thread whose `awaitChoice` records the posted UI and returns a fixed choice. */
function fakeThread(choice: unknown) {
  const awaited: unknown[] = [];
  const thread = {
    async awaitChoice(ui: unknown) {
      awaited.push(ui);
      return choice;
    },
  };
  return { thread, awaited };
}

/** Depth-first text content of an IR tree. */
function treeText(nodes: BotNode[]): string {
  function collectText(node: BotNode): string {
    if (node.type === "text") return String(node.props?.value ?? "");
    const children = node.props?.children;
    const childArr = Array.isArray(children)
      ? (children as BotNode[])
      : children &&
          typeof children === "object" &&
          "type" in (children as object)
        ? [children as BotNode]
        : [];
    return childArr.map(collectText).join("");
  }
  return nodes.map(collectText).join(" ");
}

describe("confirm_write tool", () => {
  it("posts a ConfirmWrite picker and returns the resolved {confirmed:true}", async () => {
    const { thread, awaited } = fakeThread({ confirmed: true });

    const result = await confirmWriteTool.handler(
      {
        action: "Create Linear issue",
        detail: "CPK-9: Checkout 500s under load",
      },
      { thread, platform: "discord" } as never,
    );

    expect(result).toBe("The user APPROVED the write — proceed.");

    // The posted UI is a ConfirmWrite picker: amber accent + header carrying the action.
    expect(awaited).toHaveLength(1);
    const ir = renderToIR(awaited[0] as BotNode);
    const message = ir.find((n) => n.type === "message");
    expect(message?.props?.accent).toBe("#E2B340");
    const text = treeText(ir);
    expect(text).toContain("Create Linear issue");
  });

  it("returns {confirmed:false} when the user declines", async () => {
    const { thread } = fakeThread({ confirmed: false });

    const result = await confirmWriteTool.handler(
      { action: "Create Linear issue" },
      { thread, platform: "discord" } as never,
    );

    expect(result).toBe(
      "The user DECLINED — do not write; acknowledge and stop.",
    );
  });
});
