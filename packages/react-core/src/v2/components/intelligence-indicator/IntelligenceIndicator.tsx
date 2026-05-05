import React, { useEffect, useReducer, useRef, useState } from "react";
import type { Message } from "@ag-ui/core";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { useAgent, UseAgentUpdate } from "../../hooks/use-agent";

/**
 * Brief debounce on `agent.isRunning` falling edges. Multi-step agent
 * runs can emit transient `RUN_FINISHED → RUN_STARTED` cycles between
 * LLM steps inside one user turn; without a small grace window the pill
 * would flicker spinner → check → spinner. 500 ms is well below
 * human-perceptible flash latency yet long enough to absorb step blips.
 */
const RUN_IDLE_DEBOUNCE_MS = 500;

/** Hold the checkmark briefly before fading out. */
const CHECK_HOLD_MS = 800;

/**
 * Duration of the fade-out animation. Must match
 * `cpk-intelligence-pill-fade-out` keyframes in `v2/styles/globals.css`.
 */
const FADE_OUT_ANIMATION_MS = 480;

/**
 * Polling interval for `agent.isRunning`. Background: AG-UI's `runAgent`
 * snapshots `[...this.subscribers]` at invocation time and threads that
 * snapshot through the entire run pipeline (including the `finalize`
 * block that fires `onRunFinalized` and flips `isRunning` off). A
 * subscriber added AFTER `runAgent` starts — which is always the case
 * here, because the renderer mounts when the matching message first
 * appears INSIDE the run — is missing from that snapshot and never
 * receives the falling edge.
 *
 * Re-renders driven by parent state still keep the pill alive while
 * messages stream, but `agent.isRunning` only flips off via the
 * snapshotted set. A 200 ms poll reads the live property and forces a
 * re-render when it changes, closing the gap.
 */
const ISRUNNING_POLL_MS = 200;

/**
 * Tool-name regex patterns that trigger the indicator. Currently
 * hardcoded to the Intelligence MCP server's canonical tool name. If
 * we add per-instance customization later (e.g. a `CopilotKitProvider`
 * prop or a runtime-info field), this constant becomes the fallback.
 */
const DEFAULT_TOOL_PATTERNS: readonly RegExp[] = [/^bash$/];

type Phase = "spinner" | "check" | "fading" | "hidden";

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
}

/**
 * The "Using CopilotKit Intelligence" pill. Auto-mounted by
 * `CopilotChatMessageView` for every message slot when
 * `copilotkit.intelligence` is configured — callers do not register
 * this themselves. Self-gates so only the canonical message renders a
 * pill.
 *
 * Render gates (all must hold):
 *   1. `copilotkit.intelligence !== undefined` (Intelligence runtime
 *      is configured; checked by the parent before mounting, and
 *      again here as a defence)
 *   2. The message is an assistant message with at least one tool call
 *      whose name matches {@link DEFAULT_TOOL_PATTERNS}
 *   3. The message is the *latest* such matching-assistant message
 *      anywhere in `agent.messages` — i.e. no later assistant-with-
 *      matching-tool-call message exists. Tool result messages
 *      (`role: "tool"`) and prose-only assistant messages do NOT
 *      invalidate this slot, so the pill stays continuously through a
 *      multi-step tool chain instead of flickering off every time a
 *      tool reply arrives.
 *   4. The phase machine is not yet `hidden` — once a pill has faded
 *      out it stays gone; a subsequent run on the same chat mounts a
 *      fresh pill on its own assistant message rather than resurrecting
 *      this one.
 *   5. (Run scoping comes for free from `phase === "hidden"` being
 *      sticky after the previous run's fade-out — no `getRunIdForMessage`
 *      lookup is needed, and the indicator stays robust against gaps
 *      in the SDK's run-tracking map.)
 *
 * Phase machine (per-instance, all timers local):
 *   - `spinner` while `agent.isRunning`
 *   - → `check` after `agent.isRunning` falls (debounced 500 ms to
 *     absorb step-boundary `RUN_FINISHED → RUN_STARTED` blips inside
 *     one user turn)
 *   - → `fading` after a brief hold ({@link CHECK_HOLD_MS})
 *   - → `hidden` after the fade animation
 *     ({@link FADE_OUT_ANIMATION_MS})
 *
 * The "exactly one pill at a time" guarantee is structural — only one
 * message at any moment satisfies gates 2–4 — so no shared coordination
 * state is required.
 */
export function IntelligenceIndicator(
  props: IntelligenceIndicatorProps,
): React.ReactElement | null {
  const { message, agentId, label = "Using CopilotKit Intelligence" } = props;

  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({
    agentId,
    updates: [
      UseAgentUpdate.OnRunStatusChanged,
      UseAgentUpdate.OnMessagesChanged,
    ],
  });

  // Force-render trigger for the polling fallback below.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // Poll `agent.isRunning` to close the snapshot-subscriber gap. The
  // interval reads the live property and bumps the reducer only when
  // it actually changed — `lastSeenIsRunningRef` filters out no-ops.
  const lastSeenIsRunningRef = useRef(agent.isRunning);
  useEffect(() => {
    const interval = setInterval(() => {
      const live = agent.isRunning;
      if (live !== lastSeenIsRunningRef.current) {
        lastSeenIsRunningRef.current = live;
        forceRender();
      }
    }, ISRUNNING_POLL_MS);
    return () => clearInterval(interval);
  }, [agent]);

  // Phase initialization: if isRunning is true at mount, start in
  // spinner. Otherwise the run already finished before we mounted —
  // start in check so the pill briefly checks-marks then fades.
  const [phase, setPhase] = useState<Phase>(
    agent.isRunning ? "spinner" : "check",
  );

  // Spinner ↔ check transition with idle debounce. Rising edges
  // (isRunning → true) snap to spinner immediately; falling edges
  // schedule a transition to check after RUN_IDLE_DEBOUNCE_MS, which
  // can be cancelled by another rising edge inside the window.
  //
  // Once `phase` reaches `"hidden"` it stays there: a subsequent run on
  // the same chat must NOT resurrect a finished pill. New pills mount
  // on new assistant messages emitted by the new run; this instance's
  // job is done.
  useEffect(() => {
    if (phase === "hidden") return undefined;
    if (agent.isRunning) {
      setPhase("spinner");
      return undefined;
    }
    const t = setTimeout(() => setPhase("check"), RUN_IDLE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [agent.isRunning, phase]);

  // check → fading after the hold.
  useEffect(() => {
    if (phase !== "check") return undefined;
    const t = setTimeout(() => setPhase("fading"), CHECK_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // fading → hidden after the fade animation.
  useEffect(() => {
    if (phase !== "fading") return undefined;
    const t = setTimeout(() => setPhase("hidden"), FADE_OUT_ANIMATION_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // ─── Render gates ────────────────────────────────────────────────────
  // Hooks above MUST run unconditionally; bail with `null` only after.

  if (copilotkit.intelligence === undefined) return null;
  if (!config) return null;
  if (phase === "hidden") return null;

  // Must be an assistant message with at least one matching tool call.
  if (message.role !== "assistant") return null;
  // Defensive: a malformed `toolCalls` (non-array, missing nested
  // `function.name`) would otherwise throw inside `.some(...)` and take
  // down the chat tree. Treat as "no match" instead.
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const hasMatch = toolCalls.some((tc) => {
    const name = tc?.function?.name;
    return (
      typeof name === "string" &&
      DEFAULT_TOOL_PATTERNS.some((p) => p.test(name))
    );
  });
  if (!hasMatch) return null;

  // Walk `agent.messages` from the end and find the latest assistant
  // message that itself has a matching tool call. If that's not us,
  // we're not the canonical slot — return `null`.
  //
  // Earlier revisions also asked `copilotkit.getRunIdForMessage(...)`
  // to scope the walk to the current run, but the SDK's run-tracking
  // map doesn't reliably contain every assistant-with-tool-call
  // message (the bash-issuing assistant in a real MCP recall flow is
  // commonly missing) and its threadId key can drift out of sync with
  // the chat configuration. Both gaps would suppress the pill before
  // any of the slot logic ran. The walk below stays at the message
  // layer — it only needs `agent.messages` and `message.role` /
  // `message.toolCalls`, both of which the runtime always populates
  // correctly.
  //
  // Cross-run isolation: once a pill enters `phase === "hidden"` it
  // stays there (see the run-state effect above), so a finished pill
  // can't re-spawn when a later run emits new messages — the new run
  // mounts new indicator instances on its own assistant messages.
  let latestMatchingAssistantId: string | undefined;
  for (let i = agent.messages.length - 1; i >= 0; i -= 1) {
    const m = agent.messages[i]!;
    if (m.role !== "assistant") continue;
    const tcs = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    const isMatch = tcs.some((tc) => {
      const name = tc?.function?.name;
      return (
        typeof name === "string" &&
        DEFAULT_TOOL_PATTERNS.some((p) => p.test(name))
      );
    });
    if (isMatch) {
      latestMatchingAssistantId = m.id;
      break;
    }
  }
  if (latestMatchingAssistantId !== message.id) return null;

  // ─── Visual ──────────────────────────────────────────────────────────

  const showSpinner = phase === "spinner";
  const isFading = phase === "fading";

  return (
    <span
      className={
        "cpk-intelligence-pill" +
        (isFading ? " cpk-intelligence-pill--fading" : "")
      }
      role="status"
      aria-live="polite"
      aria-hidden={isFading || undefined}
      data-testid={`cpk-intelligence-pill-${message.id}`}
      title={label}
    >
      <svg
        className="cpk-intelligence-pill__icon"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={
            "cpk-intelligence-pill__ring" +
            (showSpinner ? "" : " cpk-intelligence-pill__ring--done")
          }
        />
        <path
          d="M8 12.5l3 3 5-6"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={
            "cpk-intelligence-pill__check" +
            (showSpinner ? "" : " cpk-intelligence-pill__check--shown")
          }
        />
      </svg>
      <span>{label}</span>
    </span>
  );
}
