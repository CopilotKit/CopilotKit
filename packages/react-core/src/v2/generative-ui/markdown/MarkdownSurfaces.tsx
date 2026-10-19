import React, { useContext, useInsertionEffect, useMemo } from "react";
import type { ComponentProps, ComponentType } from "react";
import { Streamdown } from "streamdown";
import { splitA2UIMarkdown } from "@copilotkit/core";
import { GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { GenerativeUIChatSlotContext } from "../chat";
import type { GenerativeUIChatSurfaceProps } from "../chat";
import { useManagerVersion } from "../hooks";
import { useRequiredGenerativeUIRuntime } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { SurfaceView } from "../SurfaceView";
import { getMarkdownSurfaceSource } from "./source";
import type { MarkdownFenceBlock } from "./source";

type MarkdownProps = Omit<ComponentProps<typeof Streamdown>, "children">;

const FADE_STYLE_ID = "a2ui-markdown-fade";
/**
 * Components fade in as they stream: each element that appears under a
 * markdown surface runs the keyframes once on mount. React keeps the keys
 * stable per component id, so an element that is already there never
 * animates again. SVG internals are left out: a chart library re-creates
 * its nodes on each render, and a fade on each of them would read as the
 * chart flashing whenever a sibling arrives. The fade runs under reduced
 * motion too, because it moves nothing.
 */
const FADE_CSS = [
  // Opacity only, so it also runs when the user asks for reduced motion:
  // that setting is about movement, and a short fade is not movement.
  "@keyframes a2ui-fade-in{from{opacity:0}to{opacity:1}}",
  "[data-a2ui-markdown-surface] .a2ui-surface *:not(svg):not(svg *){animation:a2ui-fade-in .35s ease-out both}",
].join("\n");

// There is no document on the server, so nothing is added there.
const noEffect: typeof useInsertionEffect = () => {};
const useInjectEffect =
  typeof document === "undefined" ? noEffect : useInsertionEffect;

function useFadeStyles() {
  useInjectEffect(() => {
    if (document.getElementById(FADE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FADE_STYLE_ID;
    style.textContent = FADE_CSS;
    document.head.appendChild(style);
  }, []);
}

/**
 * The default wrapper of a chat surface in the markdown transport. It draws
 * no box: a surface sits in the flow of the reply like a paragraph, and a
 * Card draws its own box when it is interactive. Nothing shows while the
 * surface streams. A rejected operation gets one line.
 */
export function DefaultMarkdownChatSurface({
  surfaceId,
  error,
  children,
}: GenerativeUIChatSurfaceProps) {
  useFadeStyles();
  return (
    <div
      data-generative-ui-chat-surface={surfaceId}
      data-a2ui-markdown-surface={surfaceId}
      className="cpk:relative cpk:my-4 cpk:flex cpk:w-full cpk:min-w-0 cpk:max-w-full cpk:flex-col"
    >
      {children}
      {error && (
        <div role="alert" className="cpk:mt-2 cpk:text-xs cpk:text-red-600">
          Part of this UI couldn't be shown.
        </div>
      )}
    </div>
  );
}

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
    useContext(GenerativeUIChatSlotContext) ?? DefaultMarkdownChatSurface;
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
