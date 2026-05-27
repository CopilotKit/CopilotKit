import React, { useEffect, useMemo, useState } from "react";
import type { Message } from "@ag-ui/core";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { useAgent, UseAgentUpdate } from "../../hooks/use-agent";
import { renderSlot } from "../../lib/slots";
import type { SlotValue } from "../../lib/slots";
import { IntelligenceIndicatorView } from "./IntelligenceIndicatorView";

/**
 * Grace window before showing the spinner. A matching tool call must
 * remain unresolved (no `tool`-role result message in `agent.messages`)
 * for at least this long before the pill appears. This filters out
 * history-replay flashes — during `connectAgent` replay, tool calls and
 * their results arrive back-to-back in sub-millisecond bursts, so the
 * timer is cancelled before it fires. Live runs cross the threshold
 * easily because the tool actually has to execute.
 */
const PENDING_THRESHOLD_MS = 100;

/**
 * Tool-name regex patterns that trigger the indicator. Matches any tool
 * name *containing* the Intelligence MCP server's canonical tool name, so
 * both the bare `copilotkit_knowledge_base_shell` and the namespaced
 * `mcp__<server>__copilotkit_knowledge_base_shell` form (emitted by
 * `@ag-ui/mcp-middleware`) light up the pill. If we add per-instance
 * customization later (e.g. a `CopilotKitProvider` prop or a runtime-info
 * field), this constant becomes the fallback.
 */
const DEFAULT_TOOL_PATTERNS: readonly RegExp[] = [
  /copilotkit_knowledge_base_shell/,
];

/**
 * Phase machine. Unlike the previous fade-out-and-unmount lifecycle, the
 * pill now persists once it reaches `finished` — it never returns to
 * `idle` and never unmounts on its own. Supersession by a newer matching
 * message is handled by the latest-matching gate, not by this machine.
 */
type Phase = "idle" | "spinner" | "finished";

export interface IntelligenceIndicatorProps {
  /** The message this indicator is attached to. */
  message: Message;
  /**
   * Agent id whose run state the indicator tracks. Pass through from
   * the surrounding chat configuration; mounting from
   * `CopilotChatMessageView` resolves this automatically.
   */
  agentId: string;
  /**
   * Optional override for the visible label. Defaults to "Using
   * CopilotKit Intelligence".
   */
  label?: string;
  /**
   * Slot override for the presentational face. A className string, a
   * props object, or a full replacement component — see
   * {@link IntelligenceIndicatorView}. Forwarded from the
   * `intelligenceIndicator` slot on `CopilotChat`.
   */
  intelligenceIndicator?: SlotValue<typeof IntelligenceIndicatorView>;
}

const isMatchingToolCallName = (name: unknown): boolean =>
  typeof name === "string" && DEFAULT_TOOL_PATTERNS.some((p) => p.test(name));

/**
 * "Tool-call-like" messages do NOT count as a real follow-up: tool
 * result messages, assistant messages that carry tool calls, and
 * empty-content assistant messages (which some providers emit as a
 * standalone wrapper around a batch of tool calls). A real follow-up
 * is anything else — most importantly an assistant message with prose
 * content, or a fresh user message.
 */
const isToolCallLikeMessage = (m: Message): boolean => {
  if (m.role === "tool") return true;
  if (m.role === "assistant") {
    const tcs = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    if (tcs.length > 0) return true;
    const content = m.content;
    return typeof content !== "string" || content.trim().length === 0;
  }
  return false;
};

/**
 * The "Using CopilotKit Intelligence" indicator brain. Auto-mounted by
 * `CopilotChatMessageView` for every assistant message slot when
 * `copilotkit.intelligence` is configured — callers do not register this
 * themselves. It owns all orchestration (run subscription, gating, and
 * the phase machine) and renders its swappable face via the
 * `intelligenceIndicator` slot.
 *
 * Render gates (all must hold):
 *   1. `copilotkit.intelligence !== undefined`
 *   2. The message is an assistant message with at least one tool call
 *      whose name matches {@link DEFAULT_TOOL_PATTERNS}
 *   3. The message is the *latest* such matching-assistant message in
 *      `agent.messages` — tool-result messages and prose-only assistant
 *      messages don't invalidate the slot, so the pill stays
 *      continuously through a multi-step tool chain.
 *   4. The phase machine is past `idle` (the pending-grace timer fired).
 *
 * Phase machine (per-instance, all timers local):
 *   - Starts in `idle` — nothing rendered.
 *   - `idle → spinner` once a matching tool call has been pending
 *     (no `tool`-role result with a matching `toolCallId`) for
 *     {@link PENDING_THRESHOLD_MS}. Replay flashes (tool call + result
 *     in the same tick) never cross this threshold.
 *   - `spinner → finished` as soon as EITHER `agent.isRunning` flips
 *     false OR a non-tool-call-like message appears later in
 *     `agent.messages` (i.e. the agent has produced a "real"
 *     follow-up — prose answer or a new user turn).
 *   - `finished` is terminal: the pill settles into its persistent
 *     resting state and stays mounted. It is removed only when a newer
 *     matching-assistant message supersedes it via gate 3.
 *
 * The "exactly one pill at a time" guarantee is structural: only one
 * message satisfies the latest-matching-assistant gate at any moment.
 */
export function IntelligenceIndicator(
  props: IntelligenceIndicatorProps,
): React.ReactElement | null {
  const {
    message,
    agentId,
    label = "Using CopilotKit Intelligence",
    intelligenceIndicator,
  } = props;

  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({
    agentId,
    updates: [
      UseAgentUpdate.OnRunStatusChanged,
      UseAgentUpdate.OnMessagesChanged,
    ],
  });

  // IDs of matching tool calls on this message.
  const matchingToolCallIds = useMemo<readonly string[]>(() => {
    if (message.role !== "assistant") return [];
    const tcs = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    const ids: string[] = [];
    for (const tc of tcs) {
      if (isMatchingToolCallName(tc?.function?.name) && tc?.id) {
        ids.push(tc.id);
      }
    }
    return ids;
  }, [message]);

  // Pending = at least one matching tool call has no corresponding
  // `tool`-role result message in `agent.messages`.
  const hasPending = useMemo(() => {
    if (matchingToolCallIds.length === 0) return false;
    const resolved = new Set<string>();
    for (const m of agent.messages) {
      if (m.role === "tool" && m.toolCallId) resolved.add(m.toolCallId);
    }
    return matchingToolCallIds.some((id) => !resolved.has(id));
  }, [matchingToolCallIds, agent.messages]);

  // True once the agent has produced a "real" message *after* this
  // assistant message — prose, a new user turn, etc. Tool-call-like
  // messages do not count (they're part of the same tool flow).
  const sawRealFollowup = useMemo(() => {
    const idx = agent.messages.findIndex((m) => m.id === message.id);
    if (idx < 0) return false;
    for (let i = idx + 1; i < agent.messages.length; i += 1) {
      if (!isToolCallLikeMessage(agent.messages[i]!)) return true;
    }
    return false;
  }, [agent.messages, message.id]);

  const [phase, setPhase] = useState<Phase>("idle");

  // idle → spinner: pending tool call hasn't been resolved within the
  // grace window. Cleared if the result arrives first (replay) or if
  // there's nothing to wait on.
  useEffect(() => {
    if (phase !== "idle") return undefined;
    if (!hasPending) return undefined;
    const t = setTimeout(() => setPhase("spinner"), PENDING_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, [phase, hasPending]);

  // spinner → finished: agent stopped running OR a real follow-up
  // message arrived. Both are independent signals; whichever fires
  // first wins. `finished` is terminal — no further transitions.
  useEffect(() => {
    if (phase !== "spinner") return undefined;
    if (!agent.isRunning || sawRealFollowup) {
      setPhase("finished");
    }
    return undefined;
  }, [phase, agent.isRunning, sawRealFollowup]);

  // ─── Render gates ────────────────────────────────────────────────────
  // Hooks above MUST run unconditionally; bail with `null` only after.

  if (copilotkit.intelligence === undefined) return null;
  if (!config) return null;
  if (phase === "idle") return null;

  if (message.role !== "assistant") return null;
  // Defensive: a malformed `toolCalls` (non-array, missing nested
  // `function.name`) would otherwise throw inside `.some(...)` and take
  // down the chat tree. Treat as "no match" instead.
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const hasMatch = toolCalls.some((tc) =>
    isMatchingToolCallName(tc?.function?.name),
  );
  if (!hasMatch) return null;

  // Walk `agent.messages` from the end and find the latest assistant
  // message that itself has a matching tool call. If that's not us,
  // we're not the canonical slot — return `null`.
  let latestMatchingAssistantId: string | undefined;
  for (let i = agent.messages.length - 1; i >= 0; i -= 1) {
    const m = agent.messages[i]!;
    if (m.role !== "assistant") continue;
    const tcs = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    if (tcs.some((tc) => isMatchingToolCallName(tc?.function?.name))) {
      latestMatchingAssistantId = m.id;
      break;
    }
  }
  if (latestMatchingAssistantId !== message.id) return null;

  // ─── Render the (swappable) face ──────────────────────────────────────

  const status = phase === "finished" ? "finished" : "in-progress";

  return renderSlot(intelligenceIndicator, IntelligenceIndicatorView, {
    message,
    status,
    label,
  });
}
