"use client";
import React, { useCallback, useMemo, useState } from "react";
import { A2UIProvider, injectStyles } from "@copilotkit/a2ui-renderer";
import type { A2UIClientEventMessage } from "@copilotkit/a2ui-renderer";
import {
  extractFenceOperations,
  prepareSurfaceOperations,
} from "@copilotkit/core";
import type { A2UIOperation } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../../providers";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import {
  A2UIBuildingState,
  A2UIRecoveryFailure,
  resolveDebugExposure,
} from "../A2UIRecoveryStates";
import {
  A2UISurfaceOrError,
  SurfaceMessageProcessor,
  runA2UIAction,
  surfaceHasRenderableContent,
} from "../A2UIMessageRenderer";
import type { A2UIUserAction } from "../A2UIMessageRenderer";
import { useA2UIMarkdownConfig } from "./A2UIMarkdownContext";
import { sendA2UIActionAsMessage } from "./action-message";

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  injectStyles();
  stylesInjected = true;
}

const HIDDEN_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0,
  pointerEvents: "none",
  overflow: "hidden",
};

export type A2UIMarkdownSurfaceProps = {
  /** Raw fence body (JSONL, possibly incomplete). */
  fenceText: string;
  /** Whether the closing fence has arrived. */
  closed: boolean;
  /** Used when the operations carry no surfaceId: `<messageId>-<fenceIndex>`. */
  fallbackSurfaceId: string;
  /** Extra operations contributed by later fences with the same surfaceId. */
  extraOperations?: A2UIOperation[];
  /** Render nothing (a later fence whose surfaceId belongs to an earlier one). */
  hidden?: boolean;
};

/**
 * Renders one ```a2ui fence as a live A2UI surface.
 *
 * Every complete component is processed as soon as it has streamed, so the
 * surface paints progressively inside an open fence. Until the operations are
 * renderable the building skeleton (or the host's loading component) shows; a
 * fence that stops mid-stream keeps whatever painted. The failure card appears
 * only for a closed fence that produced nothing renderable.
 */
export function A2UIMarkdownSurface({
  fenceText,
  closed,
  fallbackSurfaceId,
  extraOperations,
  hidden,
}: A2UIMarkdownSurfaceProps) {
  const config = useA2UIMarkdownConfig();
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const agentId = chatConfig?.agentId ?? DEFAULT_AGENT_ID;
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);

  const parsed = useMemo(() => extractFenceOperations(fenceText), [fenceText]);
  const catalogId = config?.catalogId ?? "";
  const prepared = useMemo(
    () =>
      prepareSurfaceOperations({
        operations: [...parsed.operations, ...(extraOperations ?? [])],
        fallbackSurfaceId,
        catalogId,
      }),
    [parsed.operations, extraOperations, fallbackSurfaceId, catalogId],
  );

  const handleAction = useCallback(
    async (message: A2UIClientEventMessage) => {
      if (!config) return;
      const agent = copilotkit.getAgent(agentId);
      if (!agent) return;
      if (config.actionMode === "legacy") {
        await runA2UIAction({
          message,
          agent,
          copilotkit,
          onAction: config.onAction,
        });
        return;
      }
      const action = message.userAction as A2UIUserAction | undefined;
      if (!action) return;
      const send = (next: A2UIUserAction) =>
        sendA2UIActionAsMessage({ action: next, agent, copilotkit });
      let final = action;
      if (config.onAction) {
        // Same contract as tool mode: null suppresses, a returned action
        // replaces, void sends the original.
        const result = await config.onAction(action, (forwarded) =>
          send(forwarded ?? action),
        );
        if (result === null) return;
        if (result) final = result;
      }
      await send(final);
    },
    [config, copilotkit, agentId],
  );

  if (!config || hidden) return null;

  const hasRenderable = surfaceHasRenderableContent(prepared.operations);
  if (closed && !hasRenderable) {
    const error =
      parsed.invalidLines.length > 0
        ? "The a2ui block contained invalid JSON."
        : "The a2ui block did not contain a renderable surface.";
    return (
      <A2UIRecoveryFailure
        content={{ status: "failed", error, errors: [{ raw: fenceText }] }}
        debugExposure={resolveDebugExposure(
          undefined,
          config.recovery?.debugExposure ?? "collapsed",
        )}
      />
    );
  }

  ensureStyles();
  const Loading = config.loadingComponent;
  const showSurface = ready && hasRenderable;

  return (
    <div
      className="cpk:relative cpk:my-3 cpk:flex cpk:w-full cpk:flex-col"
      data-a2ui-markdown-surface={prepared.surfaceId}
    >
      {!showSurface &&
        (Loading ? <Loading /> : <A2UIBuildingState content={null} />)}
      {prepared.operations.length > 0 && (
        <div
          aria-hidden={!showSurface}
          className="cpk:flex cpk:w-full cpk:flex-col"
          style={showSurface ? undefined : HIDDEN_STYLE}
        >
          <A2UIProvider
            key={prepared.surfaceId}
            onAction={handleAction}
            theme={config.theme}
            catalog={config.catalog}
          >
            <SurfaceMessageProcessor
              surfaceId={prepared.surfaceId}
              operations={prepared.operations}
              onReady={markReady}
            />
            <A2UISurfaceOrError surfaceId={prepared.surfaceId} />
          </A2UIProvider>
        </div>
      )}
    </div>
  );
}
