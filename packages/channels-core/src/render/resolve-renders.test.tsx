/** @jsxImportSource @copilotkit/channels-ui */
import { describe, it, expect, vi } from "vitest";
import { Message, Header, Render, Carousel } from "@copilotkit/channels-ui";
import { renderToIR } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { resolveRenders } from "./resolve-renders.js";
import type { ResolvedRenderConfig } from "./config.js";

const png = new Uint8Array([137, 80, 78, 71]);

describe("resolveRenders", () => {
  it("renders each Render once and rewrites it to a filled image", async () => {
    const renderJsxToPng = vi.fn(
      async (_node: unknown, _cfg: ResolvedRenderConfig) => png,
    );
    const stageFile = vi.fn(async () => ({ fileId: "F1" }));
    const ir = renderToIR(
      <Message>
        <Header>Week</Header>
        <Carousel>
          <Render alt="a" width={400}>
            <div>A</div>
          </Render>
          <Render alt="b">
            <div>B</div>
          </Render>
        </Carousel>
      </Message>,
    );
    const out = await resolveRenders(ir, {
      renderJsxToPng,
      stageFile,
      defaultWidth: 800,
    });
    expect(renderJsxToPng).toHaveBeenCalledTimes(2);
    expect(renderJsxToPng.mock.calls[0]?.[1]).toMatchObject({
      width: 400,
      height: 480,
    });
    expect(renderJsxToPng.mock.calls[1]?.[1]).toMatchObject({
      width: 800,
      height: 480,
    });
    // Authored React children, not a flattened IR render node.
    const firstJsx = renderJsxToPng.mock.calls[0]![0] as {
      type?: unknown;
      $$typeof?: unknown;
    };
    expect(firstJsx.type).toBe("div");
    expect(firstJsx.$$typeof).toBeDefined();
    expect(stageFile).toHaveBeenCalledTimes(2);
    const images = collect(out, "image");
    expect(images).toHaveLength(2);
    expect(images[0]?.props.alt).toBe("a");
    expect(images[0]?.props.fileId).toBe("F1");
    expect(images[0]?.props.slackFileId).toBe("F1");
    expect(collect(out, "render")).toHaveLength(0);
  });

  it("throws when Takumi returns empty bytes", async () => {
    await expect(
      resolveRenders(
        renderToIR(
          <Render alt="x">
            <div />
          </Render>,
        ),
        {
          renderJsxToPng: async () => new Uint8Array(),
          stageFile: async () => ({ fileId: "F" }),
          defaultWidth: 800,
        },
      ),
    ).rejects.toThrow("channels.render: Takumi returned empty bytes");
  });

  it("leaves a URL Image alone", async () => {
    const { Image } = await import("@copilotkit/channels-ui");
    const renderJsxToPng = vi.fn();
    const out = await resolveRenders(
      renderToIR(<Image url="https://cdn.example/x.png" alt="x" />),
      {
        renderJsxToPng,
        stageFile: async () => ({ fileId: "nope" }),
        defaultWidth: 800,
      },
    );
    expect(renderJsxToPng).not.toHaveBeenCalled();
    expect(out[0]?.props.url).toBe("https://cdn.example/x.png");
  });
});

function collect(nodes: readonly ChannelNode[], type: string): ChannelNode[] {
  const out: ChannelNode[] = [];
  const walk = (n: ChannelNode) => {
    if (n.type === type) out.push(n);
    const raw = n.props.children;
    const kids = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const k of kids) {
      if (typeof k === "object" && k && "type" in k) walk(k as ChannelNode);
    }
  };
  for (const n of nodes) walk(n);
  return out;
}
