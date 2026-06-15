/**
 * The three showcase render-tools post a JSX component to the thread. We drive
 * each handler with a fake `thread` that records the posted Renderable, then
 * assert the rendering through `renderToIR`. For `show_incident` we also reach
 * into the IR, pull the Acknowledge button's inline `onClick`, invoke it with
 * a fake interaction context, and assert it updates the message in place with
 * a green "Acknowledged" card.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import type {
  BotNode,
  InteractionContext,
  ClickHandler,
} from "@copilotkit/bot-ui";
import {
  showIncidentTool,
  showStatusTool,
  showLinksTool,
} from "../showcase-tools.js";

type IncidentCtx = Parameters<typeof showIncidentTool.handler>[1];
type StatusCtx = Parameters<typeof showStatusTool.handler>[1];
type LinksCtx = Parameters<typeof showLinksTool.handler>[1];

/** A fake `thread` recording posts and updates. */
function fakeThread() {
  const posts: unknown[] = [];
  const updates: Array<{ ref: unknown; ui: unknown }> = [];
  const thread = {
    post: vi.fn(async (ui: unknown) => {
      posts.push(ui);
      return { id: "m1" };
    }),
    update: vi.fn(async (ref: unknown, ui: unknown) => {
      updates.push({ ref, ui });
      return { id: (ref as { id: string }).id };
    }),
  };
  return { posts, updates, thread };
}

/** Depth-first: find the first IR node whose `type` matches and that has the named prop. */
function findWithProp(
  nodes: BotNode[],
  type: string,
  prop: string,
): BotNode | undefined {
  for (const node of nodes) {
    if (node.type === type && node.props && prop in node.props) return node;
    const children = node.props?.children;
    const childArr = Array.isArray(children)
      ? (children as BotNode[])
      : children && typeof children === "object"
        ? [children as BotNode]
        : [];
    const found = findWithProp(childArr, type, prop);
    if (found) return found;
  }
  return undefined;
}

/** Depth-first text content of an IR tree. */
function treeText(nodes: BotNode[]): string {
  function collectText(node: BotNode): string {
    if (node.type === "text") return String(node.props?.value ?? "");
    const children = node.props?.children;
    const childArr = Array.isArray(children)
      ? (children as BotNode[])
      : children && typeof children === "object" && "type" in (children as object)
        ? [children as BotNode]
        : [];
    return childArr.map(collectText).join("");
  }
  return nodes.map(collectText).join(" ");
}

describe("show_incident render-tool", () => {
  it("posts an interactive IncidentCard with severity accent", async () => {
    const { posts, thread } = fakeThread();
    const result = await showIncidentTool.handler(
      {
        id: "INC-1",
        title: "Checkout 500s",
        severity: "SEV1",
        summary: "Error rate spiking on /checkout.",
      },
      { thread } as unknown as IncidentCtx,
    );

    expect(posts).toHaveLength(1);
    expect(result).toBe("Posted the incident card to the user.");

    const ir = renderToIR(posts[0] as never);
    const message = ir.find((n) => n.type === "message");
    expect(message?.props?.accent).toBe("#EB5757"); // SEV1

    const text = treeText(ir);
    expect(text).toContain("SEV1");
    expect(text).toContain("Checkout 500s");
    expect(text).toContain("Acknowledge");
    expect(text).toContain("Escalate");
  });

  it("the Acknowledge button's onClick updates the message with a green card", async () => {
    const { posts, updates, thread } = fakeThread();
    await showIncidentTool.handler(
      {
        id: "INC-1",
        title: "Checkout 500s",
        severity: "SEV2",
        summary: "Latency creeping up.",
      },
      { thread } as unknown as IncidentCtx,
    );

    const ir = renderToIR(posts[0] as never);
    const button = findWithProp(ir, "button", "onClick");
    expect(button).toBeDefined();
    const onClick = button?.props.onClick as ClickHandler;

    // Invoke the inline handler with a fake interaction context.
    await onClick({
      thread,
      message: {
        ref: { id: "m1" },
        text: "",
        user: { id: "U1" },
        platform: "discord",
      },
      user: { id: "U1", name: "Alem" },
      action: { id: "a1" },
      values: {},
      platform: "discord",
    } as unknown as InteractionContext);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.ref).toEqual({ id: "m1" });
    const updatedIr = renderToIR(updates[0]?.ui as never);
    const updatedMessage = updatedIr.find((n) => n.type === "message");
    expect(updatedMessage?.props?.accent).toBe("#27AE60"); // green
    const updatedText = treeText(updatedIr);
    expect(updatedText).toContain("✅ Acknowledged · Checkout 500s");
    expect(updatedText).toContain("Ack'd by Alem");
  });
});

describe("show_status render-tool", () => {
  it("posts a StatusCard with bold field labels and accent", async () => {
    const { posts, thread } = fakeThread();
    const result = await showStatusTool.handler(
      {
        heading: "Service health",
        fields: [
          { label: "API", value: "operational" },
          { label: "Queue depth", value: "12" },
        ],
      },
      { thread } as unknown as StatusCtx,
    );

    expect(result).toBe("Posted the status card to the user.");
    const ir = renderToIR(posts[0] as never);
    const message = ir.find((n) => n.type === "message");
    expect(message?.props?.accent).toBe("#5E6AD2");
    const text = treeText(ir);
    expect(text).toContain("API");
    expect(text).toContain("Queue depth");
    expect(text).toContain("operational");
  });
});

describe("show_links render-tool", () => {
  it("posts a LinksCard rendering markdown links", async () => {
    const { posts, thread } = fakeThread();
    const result = await showLinksTool.handler(
      {
        heading: "Runbooks",
        links: [
          { label: "Auth outage", url: "https://example.com/auth" },
          { label: "Dashboard", url: "https://example.com/dash" },
        ],
      },
      { thread } as unknown as LinksCtx,
    );

    expect(result).toBe("Posted the links to the user.");
    const ir = renderToIR(posts[0] as never);
    const text = treeText(ir);
    expect(text).toContain("https://example.com/auth");
    expect(text).toContain("https://example.com/dash");
    expect(text).toContain("Auth outage");
    expect(text).toContain("Dashboard");
  });
});
