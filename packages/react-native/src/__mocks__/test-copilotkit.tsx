/**
 * Test provider that supplies a REAL `CopilotKitCoreReact` through react-core's
 * context, seeded with a fixed list of messages.
 *
 * Why real, not mocked: `CopilotChat` renders tool calls via react-core's
 * `useRenderToolCall`, which reads the renderer registry off the live
 * `CopilotKitCoreReact` instance and derives streaming status/args in core.
 * Mocking `@copilotkit/react-core/v2/headless` (as the sibling chat tests do)
 * would stub the very thing under test. Driving a real core exercises the
 * production path end-to-end.
 *
 * The core and its single "default" agent are created ONCE (via refs) and kept
 * stable across re-renders. That stability is load-bearing: `useRenderTool`
 * registers its renderer into core and deliberately does NOT remove it on
 * unmount, so a renderer registered on one render must survive a later
 * re-render that drops the registering component (the chat-history regression).
 *
 * Reusable: accepts any `messages` array, so other suites can drive
 * `CopilotChat` (or any react-core consumer) against real agent state.
 */
import React, { useMemo, useRef } from "react";
import { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import {
  CopilotKitContext,
  CopilotKitCoreReact,
  EMPTY_SET,
} from "@copilotkit/react-core/v2/context";
import type { CopilotKitContextValue } from "@copilotkit/react-core/v2/context";

/**
 * Minimal agent: only holds seeded `messages` for the chat to read. `run()` is
 * never invoked — these tests seed messages directly and never start a run.
 *
 * The declared return type is borrowed from the base method
 * (`ReturnType<AbstractAgent["run"]>`, i.e. `Observable<BaseEvent>`) so the
 * override type-checks without importing rxjs at runtime — this package's
 * bundler cannot resolve a bare `rxjs` import. A throw-only body is assignable
 * to any declared return type, so no Observable value is constructed.
 */
class SeededAgent extends AbstractAgent {
  run(): ReturnType<AbstractAgent["run"]> {
    throw new Error("SeededAgent.run() is not used in tests");
  }
}

export interface TestCopilotKitProps {
  /**
   * Messages the "default" agent exposes to `useAgent`. Typed permissively so
   * callers can pass literal fixtures (assistant-with-tool-calls, tool results)
   * without hand-annotating the AG-UI discriminated union at every call site.
   */
  messages: Array<Record<string, unknown>>;
  /**
   * Tool-call IDs the provider reports as currently executing. `useRenderToolCall`
   * reads this off context to derive `status: "executing"` for a call that has no
   * result message yet. Defaults to empty.
   */
  executingToolCallIds?: ReadonlySet<string>;
  /**
   * Publishes the stable "default" agent instance so a test can drive it the way
   * PRODUCTION does: by MUTATING `agent.messages` in place (`addMessage` pushes;
   * core's run-handler splices) rather than by re-rendering with a new `messages`
   * array. The two are not interchangeable — reassignment changes array identity
   * and therefore invalidates any `useMemo(..., [messages])`, while in-place
   * mutation does not. A consumer that only ever sees the reassigning path can
   * be silently broken against the real one, so tests for message-derived state
   * should prefer this handle.
   *
   * A test that mutates through this handle must NOT also re-render the provider:
   * the `messages` prop is re-seeded on every render (below), which would replace
   * the array the test just mutated.
   */
  agentRef?: React.MutableRefObject<AbstractAgent | null>;
  /**
   * The agent to register as "default", instead of the built-in `SeededAgent`.
   *
   * For tests that must observe what core hands an agent on a REAL run — the
   * `tools` list core advertises is built inside `RunHandler.runAgent` and is
   * reachable no other way from a consumer's position — pass an agent that
   * records its `runAgent` input. Captured on first render like the built-in
   * one, so a later re-render with a different agent is ignored (the core
   * instance, and therefore the registered renderers, must stay stable).
   */
  agent?: AbstractAgent;
  children: React.ReactNode;
}

export function TestCopilotKit({
  messages,
  executingToolCallIds = EMPTY_SET,
  agentRef: publishAgentRef,
  agent,
  children,
}: TestCopilotKitProps) {
  const agentRef = useRef<AbstractAgent | null>(null);
  if (agentRef.current === null) {
    agentRef.current = agent ?? new SeededAgent();
  }
  if (publishAgentRef) publishAgentRef.current = agentRef.current;

  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);
  if (copilotkitRef.current === null) {
    copilotkitRef.current = new CopilotKitCoreReact({
      agents__unsafe_dev_only: { default: agentRef.current },
    });
  }

  // Seed messages every render so a re-render with a new `messages` array is
  // reflected, while the core/agent instances (and therefore the registered
  // renderers) stay stable. Fixtures are messages at runtime; the single cast
  // bridges the permissive prop type to the agent's AG-UI `Message[]`.
  agentRef.current.messages = messages as unknown as Message[];

  const value = useMemo<CopilotKitContextValue>(
    () => ({
      copilotkit: copilotkitRef.current!,
      executingToolCallIds,
    }),
    [executingToolCallIds],
  );

  return (
    <CopilotKitContext.Provider value={value}>
      {children}
    </CopilotKitContext.Provider>
  );
}
