import type { ChannelNode } from "@copilotkit/channels-ui";
import type { ResolvedRenderConfig } from "./config.js";
import type { StagedFile } from "../platform-adapter.js";
import { defaultAllowImageUrl } from "./url-policy.js";

export interface ResolveRendersDeps {
  renderJsxToPng: (
    node: unknown,
    cfg: ResolvedRenderConfig,
  ) => Promise<Uint8Array>;
  stageFile: (args: {
    bytes: Uint8Array;
    filename: string;
    altText: string;
  }) => Promise<StagedFile>;
  defaultWidth: number;
  defaultHeight?: number;
  fonts?: ResolvedRenderConfig["fonts"];
  stylesheets?: ResolvedRenderConfig["stylesheets"];
  allowImageUrl?: ResolvedRenderConfig["allowImageUrl"];
}

function childrenOf(node: ChannelNode): unknown {
  return node.props.children;
}

function mapChildren(
  children: unknown,
  map: (n: ChannelNode) => Promise<ChannelNode>,
): Promise<unknown> {
  if (Array.isArray(children)) {
    return Promise.all(
      children.map((c) =>
        typeof c === "object" && c !== null && "type" in c
          ? map(c as ChannelNode)
          : c,
      ),
    );
  }
  if (typeof children === "object" && children !== null && "type" in children) {
    return map(children as ChannelNode);
  }
  return Promise.resolve(children);
}

function applyStaged(alt: string, staged: StagedFile): Record<string, unknown> {
  return {
    alt,
    ...(staged.fileId
      ? { fileId: staged.fileId, slackFileId: staged.fileId }
      : {}),
    ...(staged.dataUrl ? { dataUrl: staged.dataUrl, url: staged.dataUrl } : {}),
    ...(staged.attachmentName ? { attachmentName: staged.attachmentName } : {}),
    ...(staged.bytes ? { stagedBytes: staged.bytes } : {}),
  };
}

export async function resolveRenders(
  nodes: readonly ChannelNode[],
  deps: ResolveRendersDeps,
): Promise<ChannelNode[]> {
  const walk = async (node: ChannelNode): Promise<ChannelNode> => {
    // Do not walk <Render> children. They stay as authored React for Takumi.
    if (node.type === "render") {
      const alt = String(node.props.alt ?? "");
      const width =
        typeof node.props.width === "number"
          ? node.props.width
          : deps.defaultWidth;
      const height =
        typeof node.props.height === "number"
          ? node.props.height
          : (deps.defaultHeight ?? 480);
      const cfg: ResolvedRenderConfig = {
        fonts: deps.fonts ?? [],
        stylesheets: deps.stylesheets ?? [],
        width,
        height,
        allowImageUrl: deps.allowImageUrl ?? defaultAllowImageUrl,
      };
      const bytes = await deps.renderJsxToPng(node.props.children ?? node, cfg);
      if (bytes.byteLength === 0) {
        throw new Error("channels.render: Takumi returned empty bytes");
      }
      const staged = await deps.stageFile({
        bytes,
        filename: `render-${alt.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "image"}.png`,
        altText: alt,
      });
      return { type: "image", props: applyStaged(alt, staged) };
    }
    const kids = await mapChildren(childrenOf(node), walk);
    return {
      ...node,
      props: { ...node.props, children: kids },
    };
  };
  return Promise.all(nodes.map(walk));
}
