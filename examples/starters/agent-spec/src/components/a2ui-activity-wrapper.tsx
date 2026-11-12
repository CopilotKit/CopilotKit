"use client";

import { useEffect, useRef, useState } from "react";
import type { GenerativeUIChatSurfaceProps } from "@copilotkit/react-core/generative-ui";

/**
 * The wrapper of each generative UI surface in the chat (the
 * `generativeUISurface` slot of `CopilotChat`): a card with an
 * "Interactive UI" header and a Show/Hide toggle. The card flashes when the
 * agent updates a surface that it already rendered.
 */
export function A2UIChatSurface({
  surfaceId,
  isStreaming,
  error,
  children,
}: GenerativeUIChatSurfaceProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [flash, setFlash] = useState(false);
  const wasStreamingRef = useRef(isStreaming);
  const renderedRef = useRef(!isStreaming);

  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = isStreaming;
    if (!wasStreaming || isStreaming) return;
    // A stream ended. The first one renders the surface; a later one updates it.
    if (!renderedRef.current) {
      renderedRef.current = true;
      return;
    }
    setFlash(true);
    const timeout = window.setTimeout(() => setFlash(false), 700);
    return () => window.clearTimeout(timeout);
  }, [isStreaming]);

  const classes = [
    "a2ui-activity-message",
    collapsed ? "a2ui-activity-message--collapsed" : "",
    flash ? "a2ui-activity-message--flash" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-a2ui-activity-message
      data-generative-ui-chat-surface={surfaceId}
    >
      <div className="a2ui-activity-header">
        <div className="a2ui-activity-header-left">
          <span className="a2ui-activity-dot" aria-hidden="true" />
          <span>Interactive UI</span>
        </div>
        <button
          type="button"
          className="a2ui-activity-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      <div className="a2ui-activity-body">
        {children}
        {error && (
          <div role="alert">Part of this UI couldn&apos;t be shown.</div>
        )}
      </div>
    </div>
  );
}
