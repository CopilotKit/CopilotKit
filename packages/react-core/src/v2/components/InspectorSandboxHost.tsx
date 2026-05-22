"use client";

import { createElement, useEffect, useMemo, useReducer, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { ToolCallStatus } from "@copilotkit/core";
import { useCopilotKit } from "../context";
import {
  isParentToSandboxMessage,
  useSandboxParams,
} from "../lib/sandbox-params";
import type {
  ParentToSandboxMessage,
  SandboxToParentMessage,
} from "../lib/sandbox-params";
import { SandboxErrorBoundary } from "./SandboxErrorBoundary";

/**
 * CopilotKit Studio sandbox host.
 *
 * Renders one of:
 *  - `children` (normal app render) when the URL has no `?__cpk_sandbox=...`.
 *  - The named tool's `render(args)`, alone, inside the existing provider
 *    chain (no chat, no popup) when the URL flips it into sandbox mode.
 *
 * This component is dev-only — production builds of `CopilotKitProvider`
 * import a no-op shim instead so the sandbox code tree-shakes away. See
 * `CopilotKitProvider.tsx` for the gate.
 *
 * Spec: .chalk/plans/web-inspector-v1.md §6.5
 *
 * Sandbox-mode rendering rules:
 *  - The provider chain is fully present — the tool sees the same context,
 *    theme, query client, design system as a real production render.
 *  - Chat surfaces (`<CopilotChat>`, `<CopilotPopup>`, devtools inspector)
 *    must NOT be mounted in sandbox mode. We achieve that by short-circuiting
 *    `children` instead of layering on top.
 *  - Render errors are caught by {@link SandboxErrorBoundary} and forwarded
 *    over `postMessage`.
 *  - Unknown tool names render a textual placeholder and post
 *    `{ kind: "render-error", message: "Tool '<name>' not found" }` to the
 *    parent.
 */
export interface InspectorSandboxHostProps {
  children: ReactNode;
}

export function InspectorSandboxHost({
  children,
}: InspectorSandboxHostProps): ReactElement {
  const params = useSandboxParams();

  // Force re-render when the core's renderToolCalls list changes — a tool
  // can be registered via `useFrontendTool` after first mount, in which case
  // the tool name on the URL might initially resolve to "not found" until the
  // hook effect has run.
  const { copilotkit } = useCopilotKit();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!params) return; // skip subscription in non-sandbox mode
    const subscription = copilotkit.subscribe({
      onRenderToolCallsChanged: () => {
        forceUpdate();
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit, params]);

  // postMessage state — args may arrive via postMessage if the URL was too
  // big (or after the form changes in the parent). The merged effective args
  // is `postedArgs ?? params.args`.
  const [postedArgs, setPostedArgs] = useState<unknown>(undefined);

  useEffect(() => {
    if (!params) return;
    if (typeof window === "undefined") return;
    if (typeof window.addEventListener !== "function") return;

    const handler = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isParentToSandboxMessage(data)) return;
      const msg = data as ParentToSandboxMessage;
      if (msg.kind === "args") {
        setPostedArgs(msg.args);
      }
      // host-context: theme handling is out of scope for v1 — the host theme
      // is determined by the user's app's own provider chain. We still accept
      // the message to lock the protocol shape.
    };

    window.addEventListener("message", handler);

    // Announce readiness to the parent. `needsArgs` is true when the URL
    // didn't carry an args blob (handshake-driven path).
    const ready: SandboxToParentMessage = {
      kind: "ready",
      needsArgs: params.args === undefined,
    };
    try {
      window.parent?.postMessage(ready, "*");
    } catch {
      // Same-origin iframe parent should always accept this; swallowing the
      // throw covers the (rare) case where the parent window is gone.
    }

    return () => {
      window.removeEventListener("message", handler);
    };
  }, [params]);

  if (!params) {
    return <>{children}</>;
  }

  const effectiveArgs = postedArgs !== undefined ? postedArgs : params.args;

  return (
    <SandboxBody
      toolName={params.toolName}
      args={effectiveArgs}
      argsParseError={params.argsParseError}
    />
  );
}

interface SandboxBodyProps {
  toolName: string;
  args: unknown;
  argsParseError: string | null;
}

function SandboxBody({
  toolName,
  args,
  argsParseError,
}: SandboxBodyProps): ReactElement {
  const { copilotkit } = useCopilotKit();
  const tool = useMemo(() => {
    return (
      copilotkit.renderToolCalls.find((rc) => rc.name === toolName) ?? null
    );
  }, [copilotkit, toolName, copilotkit.renderToolCalls]);

  // Forward args-parse failures via postMessage. We do this in an effect so
  // the message fires exactly once per failure instead of on every commit.
  useEffect(() => {
    if (!argsParseError) return;
    postToParent({
      kind: "render-error",
      message: `Failed to parse sandbox args: ${argsParseError}`,
    });
  }, [argsParseError]);

  // Likewise, forward tool-not-found.
  useEffect(() => {
    if (tool) return;
    postToParent({
      kind: "render-error",
      message: `Tool '${toolName}' is not registered in this CopilotKit app.`,
    });
  }, [tool, toolName]);

  if (!tool) {
    return (
      <SandboxPlaceholder
        title="Tool not found"
        detail={
          `No render-bearing tool named "${toolName}" is registered. ` +
          `Make sure the user's app has registered it via useCopilotAction / useFrontendTool.`
        }
      />
    );
  }

  // Mirror how the chat surface invokes tool renderers — pass the same prop
  // bag with `Executing` status (the tool is "running" in the sandbox sense:
  // args known, no result yet).
  const RenderComponent = tool.render;
  const renderArgs = (args ?? {}) as Record<string, unknown>;
  const toolCallId = `__cpk_sandbox_${toolName}`;

  return (
    <SandboxErrorBoundary
      onError={(payload) => {
        postToParent({ kind: "render-error", ...payload });
      }}
      fallback={
        <SandboxPlaceholder
          title="Render error"
          detail="The tool threw while rendering. See the studio overlay for details."
        />
      }
    >
      {createElement(RenderComponent as React.ComponentType<any>, {
        name: toolName,
        toolCallId,
        args: renderArgs,
        status: ToolCallStatus.Executing,
        result: undefined,
      })}
    </SandboxErrorBoundary>
  );
}

function SandboxPlaceholder({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): ReactElement {
  return (
    <div style={placeholderStyles.shell} role="status">
      <strong style={placeholderStyles.title}>{title}</strong>
      <p style={placeholderStyles.detail}>{detail}</p>
    </div>
  );
}

function postToParent(message: SandboxToParentMessage): void {
  if (typeof window === "undefined") return;
  try {
    window.parent?.postMessage(message, "*");
  } catch {
    // No parent / cross-origin block. There's nothing useful to do here.
  }
}

const placeholderStyles: Record<string, CSSProperties> = {
  shell: {
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#444",
    padding: "1rem 1.25rem",
    border: "1px dashed #bbb",
    borderRadius: 8,
    background: "#fafafa",
    maxWidth: 480,
    margin: "1rem auto",
  },
  title: {
    display: "block",
    color: "#222",
    fontSize: 14,
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    margin: 0,
    lineHeight: 1.5,
  },
};
