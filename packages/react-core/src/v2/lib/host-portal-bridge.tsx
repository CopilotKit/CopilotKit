import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CopilotKitCore,
  ToolCallStatus,
  ToolRenderBridge,
  ToolRenderRequest,
} from "@copilotkit/core";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { CopilotKitCoreReact } from "./react-core";

interface ActiveSlot {
  req: ToolRenderRequest;
  hostEl: HTMLElement;
}

function pickRenderer(
  renderers: Readonly<ReactToolCallRenderer<any>[]>,
  req: ToolRenderRequest,
): ReactToolCallRenderer<any> | undefined {
  const exactSameAgent = renderers.find(
    (r) => r.name === req.toolName && r.agentId === req.agentId,
  );
  if (exactSameAgent) return exactSameAgent;
  const exactAnyAgent = renderers.find(
    (r) => r.name === req.toolName && !r.agentId,
  );
  if (exactAnyAgent) return exactAnyAgent;
  const wildcard = renderers.find((r) => r.name === "*");
  return wildcard;
}

/**
 * Mounts inside the CopilotKit React tree and registers a ToolRenderBridge
 * with core. When a foreign surface (web inspector, etc.) asks core to fill
 * a host DOM node for a tool call, this component portals the matching
 * React renderer into that node so it shares context with the host tree.
 */
export function HostPortalBridge({
  copilotkit,
}: {
  copilotkit: CopilotKitCore;
}) {
  const [slots, setSlots] = useState<Map<string, ActiveSlot>>(() => new Map());
  const renderersRef = useRef<Readonly<ReactToolCallRenderer<any>[]>>([]);

  if (copilotkit instanceof CopilotKitCoreReact) {
    renderersRef.current = copilotkit.renderToolCalls;
  }

  useEffect(() => {
    if (!(copilotkit instanceof CopilotKitCoreReact)) return;
    const sub = copilotkit.subscribe({
      onRenderToolCallsChanged: ({ renderToolCalls }) => {
        renderersRef.current = renderToolCalls;
        setSlots((prev) => new Map(prev));
      },
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);

  useEffect(() => {
    const bridge: ToolRenderBridge = {
      canRender: (req) =>
        Boolean(pickRenderer(renderersRef.current, req)),
      attach: (req, hostEl) => {
        setSlots((prev) => {
          const next = new Map(prev);
          next.set(req.toolCallId, { req, hostEl });
          return next;
        });
      },
      detach: (toolCallId) => {
        setSlots((prev) => {
          if (!prev.has(toolCallId)) return prev;
          const next = new Map(prev);
          next.delete(toolCallId);
          return next;
        });
      },
    };
    return copilotkit.addToolRenderBridge(bridge);
  }, [copilotkit]);

  return (
    <>
      {Array.from(slots.values()).map(({ req, hostEl }) => {
        const renderer = pickRenderer(renderersRef.current, req);
        if (!renderer) return null;
        const Renderer = renderer.render;
        const props =
          req.status === ToolCallStatus.Complete
            ? {
                name: req.toolName,
                toolCallId: req.toolCallId,
                args: req.args as any,
                status: ToolCallStatus.Complete as const,
                result: String(req.result ?? ""),
              }
            : req.status === ToolCallStatus.Executing
              ? {
                  name: req.toolName,
                  toolCallId: req.toolCallId,
                  args: req.args as any,
                  status: ToolCallStatus.Executing as const,
                  result: undefined,
                }
              : {
                  name: req.toolName,
                  toolCallId: req.toolCallId,
                  args: req.args as any,
                  status: ToolCallStatus.InProgress as const,
                  result: undefined,
                };
        return (
          <PortalErrorBoundary key={req.toolCallId}>
            {createPortal(<Renderer {...props} />, hostEl, req.toolCallId)}
          </PortalErrorBoundary>
        );
      })}
    </>
  );
}

class PortalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.warn("[CopilotKit host-portal] renderer threw", error);
  }
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}
