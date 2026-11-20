"use client";

import { useMemo } from "react";
import type { ComponentType } from "react";
import {
  CopilotChatConfigurationProvider,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { useGenerativeUIRuntime } from "@copilotkit/react-core/v2/generative-ui";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
} from "@copilotkit/shared";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import type { CanvasVersion } from "@/lib/use-canvas-versions";

type RendererProps = {
  activityType: string;
  content: GenerativeUISurfaceContent;
  message: {
    id: string;
    role: "activity";
    activityType: string;
    content: Record<string, unknown>;
  };
  agent: undefined;
};

/**
 * Draws an older version of the canvas, read-only.
 *
 * It uses CopilotKit's own surface renderer (the one the chat uses), on a
 * thread of its own named after the version. The live canvas belongs to the
 * chat's thread, so this copy never replaces it and the agent never sees it.
 * Opening the same version again finds its surface already drawn.
 */
export function StoredVersion({ version }: { version: CanvasVersion }) {
  const { copilotkit } = useCopilotKit();
  const runtime = useGenerativeUIRuntime();
  const threadId = version.id;
  const Renderer = copilotkit.renderActivityMessages.find(
    (renderer) => renderer.activityType === GENERATIVE_UI_ACTIVITY_TYPE,
  )?.render as ComponentType<RendererProps> | undefined;

  const content = useMemo<GenerativeUISurfaceContent>(
    () => ({
      surfaceId: version.surfaceId,
      target: GENERATIVE_UI_CHAT_TARGET,
      catalogId: runtime?.ui.id ?? "",
      operations: version.operations,
      status: "ready",
      rejected: [],
    }),
    [version, runtime],
  );

  if (!Renderer || !runtime) return null;
  return (
    <CopilotChatConfigurationProvider threadId={threadId}>
      <Renderer
        activityType={GENERATIVE_UI_ACTIVITY_TYPE}
        content={content}
        message={{
          id: `version:${threadId}`,
          role: "activity",
          activityType: GENERATIVE_UI_ACTIVITY_TYPE,
          content: content as unknown as Record<string, unknown>,
        }}
        agent={undefined}
      />
    </CopilotChatConfigurationProvider>
  );
}
