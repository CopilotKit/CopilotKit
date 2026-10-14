import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
} from "react";
import type { ComponentType, ReactNode } from "react";
import { z } from "zod";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
  GENERATIVE_UI_RENDER_TOOL,
} from "@copilotkit/shared";
import type {
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
// From ../context, not the provider module: the provider imports this file.
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import type { ReactActivityMessageRenderer } from "../types/react-activity-message-renderer";
import { useManagerVersion } from "./hooks";
import { useGenerativeUIRuntime } from "./runtime-context";
import { SurfaceView } from "./SurfaceView";

export interface GenerativeUIChatSurfaceProps {
  surfaceId: string;
  isStreaming: boolean;
  /**
   * Set when operations from the latest render_ui call were rejected. The
   * message is user-facing; `error.cause` holds the same list as `rejected`.
   */
  error?: Error;
  /** Rejected operations from the latest render_ui call, with validator reasons. */
  rejected: GenerativeUIRejectedOperation[];
  children: ReactNode;
}

export const GenerativeUIChatSlotContext = createContext<
  ComponentType<GenerativeUIChatSurfaceProps> | undefined
>(undefined);

export function DefaultGenerativeUIChatCard({
  surfaceId,
  isStreaming,
  error,
  children,
}: GenerativeUIChatSurfaceProps) {
  return (
    <div
      data-generative-ui-chat-surface={surfaceId}
      className="cpk:my-2 cpk:w-full cpk:rounded-xl cpk:border cpk:border-gray-200 cpk:p-3"
    >
      {children}
      {isStreaming && (
        <div className="cpk:mt-2 cpk:text-xs cpk:text-gray-500">
          Generating…
        </div>
      )}
      {error && (
        <div role="alert" className="cpk:mt-2 cpk:text-xs cpk:text-red-600">
          Part of this UI couldn't be shown.
        </div>
      )}
    </div>
  );
}

const ContentSchema = z
  .object({
    surfaceId: z.string(),
    target: z.string(),
    catalogId: z.string(),
    operations: z.array(z.any()),
    status: z.enum(["streaming", "ready", "error"]),
    rejected: z
      .array(z.object({ index: z.number(), reason: z.string() }))
      .default([]),
  })
  .passthrough();

function GenerativeUIChatActivity({
  content,
  agent,
}: {
  content: GenerativeUISurfaceContent;
  agent: { threadId?: string; agentId?: string } | undefined;
}) {
  const runtime = useGenerativeUIRuntime();
  const threadId = useCopilotChatConfiguration()?.threadId ?? agent?.threadId;
  const Wrapper =
    useContext(GenerativeUIChatSlotContext) ?? DefaultGenerativeUIChatCard;
  useManagerVersion(runtime);
  useLayoutEffect(() => {
    if (runtime && threadId)
      runtime.manager.ingest(threadId, agent?.agentId, content);
  }, [runtime, threadId, agent?.agentId, content]);

  if (!runtime || !threadId || content.target !== GENERATIVE_UI_CHAT_TARGET)
    return null;
  const surface = runtime.manager.getSurface(threadId, content.surfaceId);
  if (!surface) return null;
  // Both lists cover only the latest render_ui call (see the manager's ingest).
  // Custom wrappers get the detailed reasons (`rejected`, `error.cause`), and
  // client-side ones also reach `errorBoundary.onError`; the default card
  // shows a generic message.
  const rejected = [...(content.rejected ?? []), ...surface.clientRejected];
  const error = rejected.length
    ? new Error(`${rejected.length} UI update(s) could not be shown`, {
        cause: rejected,
      })
    : undefined;
  return (
    <Wrapper
      surfaceId={content.surfaceId}
      isStreaming={content.status === "streaming"}
      error={error}
      rejected={rejected}
    >
      <SurfaceView surface={surface} />
    </Wrapper>
  );
}

export function createGenerativeUIActivityRenderer(): ReactActivityMessageRenderer<GenerativeUISurfaceContent> {
  return {
    activityType: GENERATIVE_UI_ACTIVITY_TYPE,
    content:
      ContentSchema as unknown as ReactActivityMessageRenderer<GenerativeUISurfaceContent>["content"],
    render:
      GenerativeUIChatActivity as ReactActivityMessageRenderer<GenerativeUISurfaceContent>["render"],
  };
}

/** Hides the raw `render_ui` tool call; the surface activity owns the UX. */
export function GenerativeUIToolCallRenderer(): null {
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    const renderer = defineToolCallRenderer({
      name: GENERATIVE_UI_RENDER_TOOL,
      args: z.any(),
      render: () => <></>,
    });
    const existing = (copilotkit as any)._renderToolCalls ?? [];
    copilotkit.setRenderToolCalls([
      ...existing.filter((rc: any) => rc.name !== GENERATIVE_UI_RENDER_TOOL),
      renderer,
    ]);
  }, [copilotkit]);
  return null;
}
