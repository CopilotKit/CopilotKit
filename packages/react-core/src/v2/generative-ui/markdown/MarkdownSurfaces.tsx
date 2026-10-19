import React, { useContext, useMemo } from "react";
import type { ComponentProps, ComponentType } from "react";
import { Streamdown } from "streamdown";
import { splitA2UIMarkdown } from "@copilotkit/core";
import { GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import {
  DefaultGenerativeUIChatCard,
  GenerativeUIChatSlotContext,
} from "../chat";
import type { GenerativeUIChatSurfaceProps } from "../chat";
import { useManagerVersion } from "../hooks";
import { useRequiredGenerativeUIRuntime } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { SurfaceView } from "../SurfaceView";
import { getMarkdownSurfaceSource } from "./source";
import type { MarkdownFenceBlock } from "./source";

type MarkdownProps = Omit<ComponentProps<typeof Streamdown>, "children">;

export type MarkdownSurfacesProps = MarkdownProps & {
  /** The text of the assistant message, complete or still streaming. */
  content: string;
  /** The id of the message. The fences of the message are found by it. */
  messageId: string;
};

/**
 * One chat surface in the chat wrapper. Nothing renders until the surface
 * has its root component, so a half-streamed fence shows no empty card.
 */
function ChatSurface({
  runtime,
  threadId,
  surfaceId,
  Wrapper,
}: {
  runtime: GenerativeUIRuntime;
  threadId: string;
  surfaceId: string;
  Wrapper: ComponentType<GenerativeUIChatSurfaceProps>;
}) {
  const surface = runtime.manager.getSurface(threadId, surfaceId);
  const root = surface?.model.componentsModel.get(GENERATIVE_UI_ROOT_ID);
  if (!surface || !root) return null;
  const rejected = [...surface.serverRejected, ...surface.clientRejected];
  const error = rejected.length
    ? new Error(`${rejected.length} UI update(s) could not be shown`, {
        cause: rejected,
      })
    : undefined;
  return (
    <Wrapper
      surfaceId={surfaceId}
      isStreaming={surface.status === "streaming"}
      error={error}
      rejected={rejected}
    >
      <SurfaceView surface={surface} />
    </Wrapper>
  );
}

/** The blocks of one fence: lifted prose and chat surfaces, in order. */
function FenceBlocks({
  blocks,
  runtime,
  threadId,
  markdownProps,
}: {
  blocks: MarkdownFenceBlock[];
  runtime: GenerativeUIRuntime;
  threadId: string;
  markdownProps: MarkdownProps;
}) {
  const Wrapper =
    useContext(GenerativeUIChatSlotContext) ?? DefaultGenerativeUIChatCard;
  let surfaceCount = 0;
  return (
    <>
      {blocks.map((block) => {
        // Keys follow the surfaces, so a surface keeps its element when
        // prose splits off around it during streaming.
        if (block.kind === "markdown") {
          return (
            <Streamdown key={`md-${surfaceCount}`} {...markdownProps}>
              {block.markdown}
            </Streamdown>
          );
        }
        surfaceCount++;
        return (
          <ChatSurface
            key={block.surfaceId}
            runtime={runtime}
            threadId={threadId}
            surfaceId={block.surfaceId}
            Wrapper={Wrapper}
          />
        );
      })}
    </>
  );
}

/**
 * Experimental. Renders an assistant message of the markdown transport.
 * Prose renders as markdown. In place of each ```a2ui fence:
 *
 * - the fence that created a chat surface renders that surface (and the
 *   prose lifted out of it) in the chat wrapper;
 * - every other fence renders nothing: a fence that updates the surface of
 *   an earlier fence, or a fence for a named target, which
 *   `<GenerativeUISurface id>` renders.
 *
 * Use it inside `<CopilotKitProvider generativeUI={{ ui, transport: "markdown" }}>`.
 * `CopilotChatAssistantMessage` uses it there on its own.
 *
 * @example
 * ```tsx
 * <MarkdownSurfaces content={message.content} messageId={message.id} />
 * ```
 */
export function MarkdownSurfaces({
  content,
  messageId,
  ...markdownProps
}: MarkdownSurfacesProps) {
  const runtime = useRequiredGenerativeUIRuntime();
  const chatThreadId = useCopilotChatConfiguration()?.threadId;
  useManagerVersion(runtime);
  const segments = useMemo(() => splitA2UIMarkdown(content), [content]);
  const threadId = chatThreadId ?? runtime.manager.getActiveThread();
  const source = getMarkdownSurfaceSource(runtime);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "markdown") {
          return (
            <Streamdown key={`md-${index}`} {...markdownProps}>
              {segment.text}
            </Streamdown>
          );
        }
        const blocks = threadId
          ? source.getFenceBlocks(threadId, messageId, segment.index)
          : undefined;
        if (!threadId || !blocks) return null;
        return (
          <FenceBlocks
            key={`a2ui-${segment.index}`}
            blocks={blocks}
            runtime={runtime}
            threadId={threadId}
            markdownProps={markdownProps}
          />
        );
      })}
    </>
  );
}
