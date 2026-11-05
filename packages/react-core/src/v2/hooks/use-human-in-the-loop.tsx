import { useCopilotKit } from "../context";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../types/human-in-the-loop";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { ToolCallStatus } from "@copilotkit/core";
import { useCallback, useLayoutEffect, useRef } from "react";
import React from "react";
import { useFrontendTool } from "./use-frontend-tool";

/** Registration name of a catch-all tool: handles any otherwise-unhandled call. */
const WILDCARD_TOOL_NAME = "*";

export function useHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactHumanInTheLoop<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  // Resolvers keyed by tool call id. A single slot would make concurrent HITL
  // calls (two agents sharing one global hook, or overlapping `runTool`s)
  // cross-deliver answers: registering call B would overwrite call A's
  // resolver, and respond() would settle whichever promise landed last
  // (#8194). The handler reads its id off the execution context the core
  // already passes (`context.toolCallId`).
  interface PendingInteraction {
    resolve: (result: unknown) => void;
    reject: (reason?: unknown) => void;
  }
  const resolversRef = useRef<Map<string, PendingInteraction>>(new Map());
  // Cleanup per pending call id: detaches the pending abort listener, cleared
  // whenever that call's promise settles (via respond() or abort) so the
  // listener can't fire twice or leak after the interaction is done.
  const cleanupAbortRef = useRef<Map<string, () => void>>(new Map());
  // Locally generated keys for calls that arrive without a tool call id
  // (programmatic runTool).
  const nextLocalCallIdRef = useRef(0);

  // Settle one pending interaction: detach its abort listener, drop it from
  // the pending map, then run the settle action.
  const settle = useCallback(
    (toolCallId: string, run: (interaction: PendingInteraction) => void) => {
      const interaction = resolversRef.current.get(toolCallId);
      if (!interaction) return;
      resolversRef.current.delete(toolCallId);
      cleanupAbortRef.current.get(toolCallId)?.();
      cleanupAbortRef.current.delete(toolCallId);
      run(interaction);
    },
    [],
  );

  const respond = useCallback(async (result: unknown, toolCallId?: string) => {
    const pending = resolversRef.current;
    // Row-scoped routing: the caller (render props) targets the interaction
    // the answer belongs to.
    if (toolCallId !== undefined) {
      settle(toolCallId, (interaction) => interaction.resolve(result));
      return;
    }
    // Backward-compatible no-id form. A single pending interaction resolves
    // exactly as before; with several outstanding, resolving the most recent
    // keeps the historical behavior explicit while warning that the answer
    // could not be routed to a specific interaction.
    const ids = [...pending.keys()];
    if (ids.length === 0) return;
    if (ids.length > 1) {
      console.warn(
        `[CopilotKit] respond() called without a toolCallId while ${ids.length} interactions are pending — resolving the most recent. Pass a toolCallId to target a specific interaction.`,
      );
    }
    settle(ids[ids.length - 1], (interaction) => interaction.resolve(result));
  }, [settle]);

  const handler = useCallback(
    async (
      _args: T,
      context?: { signal?: AbortSignal; toolCall?: { id?: string } },
    ) => {
      const signal = context?.signal;
      // The core passes the executing call as `context.toolCall`; calls without
      // one (programmatic runTool) get a locally generated key.
      const toolCallId =
        context?.toolCall?.id ?? `__hitl_anonymous_${++nextLocalCallIdRef.current}`;
      return new Promise((resolve, reject) => {
        // If the run was already aborted before the handler ran, reject
        // immediately so core records an explicit error tool result instead of
        // silently resolving to an empty string.
        if (signal?.aborted) {
          reject(new Error("Human-in-the-loop interaction aborted"));
          return;
        }

        // A re-registration of the same tool call id (a retried call)
        // supersedes the previous promise: reject it as aborted rather than
        // silently dropping its resolver, which would hang the caller.
        const superseded = resolversRef.current.get(toolCallId);
        if (superseded) {
          cleanupAbortRef.current.get(toolCallId)?.();
          cleanupAbortRef.current.delete(toolCallId);
          resolversRef.current.delete(toolCallId);
          superseded.reject(
            new Error("Human-in-the-loop interaction superseded by a retry of the same tool call"),
          );
        }

        resolversRef.current.set(toolCallId, { resolve, reject });

        if (signal) {
          const onAbort = () => {
            resolversRef.current.delete(toolCallId);
            cleanupAbortRef.current.delete(toolCallId);
            reject(new Error("Human-in-the-loop interaction aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          cleanupAbortRef.current.set(toolCallId, () => {
            signal.removeEventListener("abort", onAbort);
          });
        }
      });
    },
    [],
  );

  const RenderComponent: ReactToolCallRenderer<T>["render"] = useCallback(
    (props) => {
      const ToolComponent = tool.render;

      // Build the HITL render props per status. `props` already carries
      // `toolCallId`; we overwrite `name`/`description` with the tool's
      // registration values and add the registration `agentId`, so the HITL
      // render always receives the full prop contract. `respond` is only live
      // while the tool is executing.
      //
      // A catch-all registration is the exception: `"*"` is not the name of
      // anything the agent called, so the incoming `props.name` — the tool
      // actually being handled — is kept instead. It is what lets one
      // catch-all render serve N tools.
      const name = tool.name === WILDCARD_TOOL_NAME ? props.name : tool.name;

      if (props.status === ToolCallStatus.InProgress) {
        const enhancedProps = {
          ...props,
          name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === ToolCallStatus.Executing) {
        const enhancedProps = {
          ...props,
          name,
          description: tool.description || "",
          agentId: tool.agentId,
          // Route this row's answer to its own interaction, not whichever
          // call registered last (#8194).
          respond: (result: unknown) => respond(result, props.toolCallId),
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === ToolCallStatus.Complete) {
        const enhancedProps = {
          ...props,
          name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      }

      // ToolCallStatus has only the three states handled above, so this point
      // is unreachable and `props` narrows to `never`. The assignment turns a
      // newly-added status into a compile error here — forcing it to get its
      // own branch above — instead of silently rendering without `respond`.
      const exhaustiveCheck: never = props;
      return exhaustiveCheck;
    },
    [tool.render, tool.name, tool.description, tool.agentId, respond],
  );

  const frontendTool: ReactFrontendTool<T> = {
    ...tool,
    type: "human-in-the-loop",
    handler,
    render: RenderComponent,
  };

  useFrontendTool(frontendTool, deps);

  // Human-in-the-loop tools should remove their renderer on unmount
  // since they can't respond to user interactions anymore.
  //
  // This MUST stay a layout effect to match `useFrontendTool`, which registers
  // the renderer in its own layout effect. React runs every cleanup in a phase
  // before any effect of that same phase, but it runs the whole layout phase
  // ahead of the whole passive phase. If this teardown were passive while the
  // registration is layout, a keyed remount would order the outgoing
  // instance's removal *after* the incoming instance's registration and delete
  // the renderer that had just been added, leaving the tool unrenderable.
  useLayoutEffect(() => {
    return () => {
      copilotkit.removeHookRenderToolCall(tool.name, tool.agentId);
    };
  }, [copilotkit, tool.name, tool.agentId]);
}
