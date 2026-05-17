import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  defineSlackComponent,
  componentToFrontendTool,
} from "../slack-component.js";
import type { FrontendToolContext } from "../frontend-tools.js";

function makeCtx(): {
  ctx: FrontendToolContext;
  postFn: ReturnType<typeof vi.fn>;
} {
  const postFn = vi.fn(async () => ({ ok: true, ts: "1700000000.000100" }));
  const ctx = {
    client: { chat: { postMessage: postFn } } as never,
    channel: "C1",
    threadTs: "100.0",
    botUserId: "BOT01",
    conversationKey: "C1::100.0",
  } satisfies FrontendToolContext;
  return { ctx, postFn };
}

describe("defineSlackComponent", () => {
  it("returns the component unchanged but with inferred generics", () => {
    const schema = z.object({ x: z.number() });
    const c = defineSlackComponent({
      name: "test",
      description: "d",
      props: schema,
      render: ({ x }) => [
        { type: "section", text: { type: "mrkdwn", text: `x=${x}` } },
      ],
    });
    expect(c.name).toBe("test");
    expect(c.props).toBe(schema);
    // Render is callable with the typed props shape:
    const blocks = c.render({ x: 7 });
    expect(blocks).toHaveLength(1);
  });
});

describe("componentToFrontendTool", () => {
  it("converts the component into a tool whose params are the schema", () => {
    const schema = z.object({ name: z.string() });
    const c = defineSlackComponent({
      name: "card",
      description: "d",
      props: schema,
      render: ({ name }) => [
        { type: "section", text: { type: "mrkdwn", text: name } },
      ],
    });
    const t = componentToFrontendTool(c);
    expect(t.name).toBe("card");
    expect(t.description).toBe("d");
    expect(t.parameters).toBe(schema);
  });

  it("execute() renders blocks and posts via chat.postMessage", async () => {
    const c = defineSlackComponent({
      name: "card",
      description: "test card",
      props: z.object({ title: z.string() }),
      render: ({ title }) => [
        { type: "header", text: { type: "plain_text", text: title } },
        { type: "divider" },
      ],
    });
    const t = componentToFrontendTool(c);
    const { ctx, postFn } = makeCtx();
    const result = JSON.parse(
      (await t.handler({ title: "Hello" }, ctx)) as string as string,
    );
    expect(result.ok).toBe(true);
    expect(result.rendered).toBe("card");
    expect(result.messageTs).toBe("1700000000.000100");
    expect(postFn).toHaveBeenCalledTimes(1);
    const arg = postFn.mock.calls[0]?.[0];
    expect(arg.channel).toBe("C1");
    expect(arg.thread_ts).toBe("100.0");
    expect(arg.blocks).toHaveLength(2);
    expect(arg.blocks[0]).toEqual({
      type: "header",
      text: { type: "plain_text", text: "Hello" },
    });
  });

  it("uses fallbackText() when provided", async () => {
    const c = defineSlackComponent({
      name: "card",
      description: "fallback to description if omitted",
      props: z.object({ name: z.string() }),
      render: () => [{ type: "divider" }],
      fallbackText({ name }) {
        return `Card for ${name}`;
      },
    });
    const { ctx, postFn } = makeCtx();
    await componentToFrontendTool(c).handler({ name: "Atai" }, ctx);
    expect(postFn.mock.calls[0]?.[0]?.text).toBe("Card for Atai");
  });

  it("falls back to component description when fallbackText is omitted", async () => {
    const c = defineSlackComponent({
      name: "card",
      description: "Sensible default fallback",
      props: z.object({}),
      render: () => [{ type: "divider" }],
    });
    const { ctx, postFn } = makeCtx();
    await componentToFrontendTool(c).handler({}, ctx);
    expect(postFn.mock.calls[0]?.[0]?.text).toBe("Sensible default fallback");
  });

  it("returns ok:false with the error message if chat.postMessage throws", async () => {
    const c = defineSlackComponent({
      name: "card",
      description: "d",
      props: z.object({}),
      render: () => [{ type: "divider" }],
    });
    const ctx = {
      client: {
        chat: {
          postMessage: vi.fn(async () => {
            throw new Error("rate_limited");
          }),
        },
      } as never,
      channel: "C1",
      botUserId: "BOT01",
      conversationKey: "C1::100.0",
    } satisfies FrontendToolContext;
    const result = JSON.parse(
      (await componentToFrontendTool(c).handler({}, ctx)) as string,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rate_limited");
  });
});
