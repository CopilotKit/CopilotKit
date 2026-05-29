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
 * for at least this long before the indicator transitions out of
 * `hidden`. This filters out history-replay flashes — during
 * `connectAgent` replay, tool calls and their results arrive
 * back-to-back in sub-millisecond bursts, so the timer is cancelled
 * before it fires. Live runs cross the threshold easily because the
 * tool actually has to execute.
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
 * Phase machine. Once `finished` is reached the indicator persists
 * indefinitely; supersession across messages is handled by the
 * structural last-in-turn gate, not by this machine.
 */
type Phase = "hidden" | "spinner" | "finished";

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
   * Optional override for the visible label. Defaults to
   * "CopilotKit Intelligence".
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

const messageHasMatchingToolCall = (m: Message): boolean => {
  if (m.role !== "assistant") return false;
  const tcs = Array.isArray(m.toolCalls) ? m.toolCalls : [];
  return tcs.some((tc) => isMatchingToolCallName(tc?.function?.name));
};

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
 * `copilotkit.intelligence` is configured — callers do not register
 * this themselves. It owns all orchestration (run subscription, gating,
 * and the phase machine) and renders its swappable face via the
 * `intelligenceIndicator` slot.
 *
 * Render gates (all must hold):
 *   1. `copilotkit.intelligence !== undefined`
 *   2. The message is an assistant message with at least one tool call
 *      whose name matches {@link DEFAULT_TOOL_PATTERNS}.
 *   3. The message is the *last bash-using assistant message in its
 *      turn*. A turn is bounded by user messages: walking forward from
 *      this message, hitting another bash-using assistant before a
 *      user message (or the end of `agent.messages`) means we are NOT
 *      last-in-turn and must return `null`.
 *   4. The phase machine is past `hidden`.
 *
 * Per-turn semantics ensure that every prior agent turn that used
 * Intelligence keeps its own persistent indicator in chat history —
 * they never disappear when a new turn starts, because each anchors
 * to a different assistant message that remains last-in-turn for its
 * respective turn.
 *
 * Phase machine (per-instance, all timers local):
 *   - Starts in `hidden`, unless the message mounts onto an
 *     already-completed turn (no pending work, agent stopped or a
 *     real follow-up already present), in which case the lazy
 *     `useState` initializer starts directly in `finished`. This is
 *     what avoids a "hidden flash" on history replay.
 *   - `hidden → spinner` once a matching tool call has been pending
 *     (no `tool`-role result with a matching `toolCallId`) for
 *     {@link PENDING_THRESHOLD_MS}. Replay flashes (tool call + result
 *     in the same tick) never cross this threshold.
 *   - `hidden → finished` if after the grace window the turn is
 *     already complete (no pending work AND
 *     `sawRealFollowup || !agent.isRunning`). Handles very fast tools
 *     whose result lands within the grace window.
 *   - `spinner → finished` as soon as EITHER `agent.isRunning` flips
 *     false OR a non-tool-call-like message appears later in
 *     `agent.messages` (i.e. the agent produced a "real" follow-up —
 *     prose answer or a new user turn).
 *   - `finished` is terminal: the indicator settles into its
 *     persistent tag form and stays mounted.
 */
export function IntelligenceIndicator(
  props: IntelligenceIndicatorProps,
): React.ReactElement | null {
  const {
    message,
    agentId,
    label = "CopilotKit Intelligence",
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

  // Turn-completion signal — set the moment the agent stops running or
  // a "real" follow-up (prose / user turn) appears after this message.
  // Independent of whether the pending tool call resolved; if the run
  // finishes with a still-unresolved match (rare in production, common
  // in tests), the indicator should still settle.
  const turnComplete = sawRealFollowup || !agent.isRunning;

  // Lazy init: if this indicator mounts onto a message whose turn has
  // already completed (e.g. history replay finished before mount),
  // skip directly to `finished` — no `hidden` flash, no spinner blip.
  const [phase, setPhase] = useState<Phase>(() =>
    turnComplete ? "finished" : "hidden",
  );

  // hidden → spinner OR hidden → finished (after grace window).
  useEffect(() => {
    if (phase !== "hidden") return undefined;
    const t = setTimeout(() => {
      if (turnComplete) {
        setPhase("finished");
      } else if (hasPending) {
        setPhase("spinner");
      }
      // else: stay hidden — turn is still live but no pending work
      // matched yet (e.g. waiting for the tool call chunk to land).
    }, PENDING_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, [phase, hasPending, turnComplete]);

  // spinner → finished
  useEffect(() => {
    if (phase !== "spinner") return undefined;
    if (turnComplete) {
      setPhase("finished");
    }
    return undefined;
  }, [phase, turnComplete]);

  // ─── Render gates ────────────────────────────────────────────────────
  // Hooks above MUST run unconditionally; bail with `null` only after.

  if (copilotkit.intelligence === undefined) return null;
  if (!config) return null;
  if (phase === "hidden") return null;

  if (message.role !== "assistant") return null;
  if (!messageHasMatchingToolCall(message)) return null;

  // Per-turn last-in-turn gate. Walk forward from this message; if we
  // hit a user message (turn boundary) before encountering another
  // bash-using assistant message, this message is the last-in-turn
  // and the indicator renders here. Otherwise a later assistant in
  // the same turn owns the indicator and we return `null`.
  const idx = agent.messages.findIndex((m) => m.id === message.id);
  if (idx < 0) return null;
  for (let i = idx + 1; i < agent.messages.length; i += 1) {
    const m = agent.messages[i]!;
    if (m.role === "user") break;
    if (messageHasMatchingToolCall(m)) return null;
  }

  // ─── Render the (swappable) face ──────────────────────────────────────

  const status = phase === "finished" ? "finished" : "in-progress";

  return renderSlot(intelligenceIndicator, IntelligenceIndicatorView, {
    message,
    status,
    label,
  });
}
