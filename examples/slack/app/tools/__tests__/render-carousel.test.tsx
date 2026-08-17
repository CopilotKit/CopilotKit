/**
 * `render_carousel` posts one mixed Message: native header + carousel of
 * Render snapshots + native Buy buttons. Drive the handler with a fake thread
 * and inspect the posted tree through renderToIR.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToIR } from "@copilotkit/channels";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels";
import {
  renderCarouselTool,
  carouselCommand,
  SAMPLE_CATALOG,
} from "../render-carousel.js";

function fakeThread() {
  const posts: unknown[] = [];
  const thread = {
    post: vi.fn(async (ui: unknown) => {
      posts.push(ui);
      return { id: "m1" };
    }),
  };
  return { posts, thread };
}

function collectTypes(
  node: ChannelNode | unknown,
  acc: string[] = [],
): string[] {
  if (!node || typeof node !== "object") return acc;
  const n = node as ChannelNode;
  if (typeof n.type === "string") acc.push(n.type);
  const children = n.props?.children;
  const list = Array.isArray(children) ? children : children ? [children] : [];
  for (const child of list) collectTypes(child, acc);
  return acc;
}

function findButtons(nodes: ChannelNode[]): ChannelNode[] {
  const out: ChannelNode[] = [];
  for (const node of nodes) {
    if (node.type === "button") out.push(node);
    const children = node.props?.children;
    const list = Array.isArray(children)
      ? (children as ChannelNode[])
      : children && typeof children === "object"
        ? [children as ChannelNode]
        : [];
    out.push(...findButtons(list));
  }
  return out;
}

describe("render_carousel tool", () => {
  it("posts a carousel of sample React product cards plus native Buy buttons", async () => {
    const { posts, thread } = fakeThread();
    const res = await renderCarouselTool.handler({}, { thread } as never);

    expect(posts).toHaveLength(1);
    expect(res).toBe("Posted a 3-item carousel.");

    const ir = renderToIR(posts[0] as never);
    const types = ir.flatMap((node) => collectTypes(node));
    expect(types).toContain("carousel");
    expect(types.filter((t) => t === "carouselCard")).toHaveLength(
      SAMPLE_CATALOG.length,
    );
    expect(types.filter((t) => t === "render")).toHaveLength(
      SAMPLE_CATALOG.length,
    );
    expect(types.filter((t) => t === "button")).toHaveLength(
      SAMPLE_CATALOG.length,
    );
  });

  it("uses caller items when they are provided", async () => {
    const { posts, thread } = fakeThread();
    const res = await renderCarouselTool.handler(
      {
        heading: "Sale",
        items: [
          { name: "Mug", price: "$12", color: "#111111", tag: "Last one" },
        ],
      },
      { thread } as never,
    );
    expect(res).toBe("Posted a 1-item carousel.");
    const ir = renderToIR(posts[0] as never);
    const types = ir.flatMap((node) => collectTypes(node));
    expect(types.filter((t) => t === "carouselCard")).toHaveLength(1);
  });

  it("Buy posts a cart line", async () => {
    const { posts, thread } = fakeThread();
    await renderCarouselTool.handler({}, { thread } as never);
    const ir = renderToIR(posts[0] as never);
    const [buy] = findButtons(ir);
    const onClick = buy?.props.onClick as
      | ((ctx: InteractionContext) => Promise<void>)
      | undefined;
    expect(onClick).toEqual(expect.any(Function));
    const actor = { id: "u1", kind: "human" as const, name: "Alem" };
    const user = { id: "u1", name: "Alem" };
    await onClick!({
      thread: thread as never,
      user,
      actor,
      message: {
        text: "",
        user,
        actor,
        ref: { id: "m1" },
        platform: "slack",
      },
      action: { id: "buy", value: "buy:Red running shoes" },
      values: {},
      platform: "slack",
    });
    expect(thread.post).toHaveBeenCalledTimes(2);
    expect(thread.post.mock.calls[1]![0]).toMatch(/Red running shoes/);
  });
});

describe("/carousel command", () => {
  it("posts the sample catalog", async () => {
    const { posts, thread } = fakeThread();
    await carouselCommand.handler({ thread } as never);
    expect(posts).toHaveLength(1);
    const ir = renderToIR(posts[0] as never);
    expect(ir.flatMap((node) => collectTypes(node))).toContain("carousel");
  });
});
