/**
 * Serialization helpers for the window between `isRunning = true` and the
 * assignment of `activeRunDetach$` / `activeRunCompletionPromise`.
 *
 * `@ag-ui/client` AbstractAgent (through at least 0.0.59) does:
 *
 *   1. `this.isRunning = true`          — synchronous
 *   2. `await this.onInitialize(...)`    — yields
 *   3. assign detach$ + completion promise
 *
 * `detachActiveRun()` starts with `if (!this.activeRunDetach$) return`, so
 * both CopilotKit guards fail open inside that window unless they wait for
 * the handles (or, on the connect-replay path, we assign them first).
 *
 * These fields are private on AbstractAgent, so they are reached through a
 * structural cast — the same escape hatch `connect-replay.ts` already uses.
 *
 * A proxied Intelligence agent is a different shape: it mirrors `isRunning`
 * from the delegate but never assigns its own handles (it does not call
 * `super.connectAgent`). The wait is keyed on the agent that owns the
 * handles — the same way `ProxiedCopilotRuntimeAgent.detachActiveRun`
 * already delegates the action — and is bounded so a mirrored `isRunning`
 * cannot spin forever. When the bound expires the helpers fall through to
 * the pre-#6937 behavior (detach immediately / do not await a missing
 * completion promise).
 */

interface AgentRunLifecycle {
  isRunning: boolean;
  detachActiveRun?: () => Promise<void>;
  activeRunCompletionPromise?: Promise<void>;
  activeRunDetach$?: unknown;
  delegate?: object;
}

/**
 * Upper bound for waiting out `await onInitialize`. The race this PR
 * closes is one initializer, not a long-lived Intelligence connect stream.
 */
const ON_INITIALIZE_HANDLE_WAIT_MS = 2_000;

function asLifecycle(agent: object): AgentRunLifecycle {
  return agent as AgentRunLifecycle;
}

function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Walk to the agent that actually owns run handles.
 *
 * `ProxiedCopilotRuntimeAgent` keeps a `delegate` and forwards
 * `detachActiveRun` to it. Asking the proxy whether `activeRunDetach$` is
 * assigned is the wrong question — that field lives on the delegate.
 */
function runHandleOwner(agent: object): object {
  const seen = new Set<object>();
  let current: object = agent;
  while (!seen.has(current)) {
    seen.add(current);
    const delegate = asLifecycle(current).delegate;
    if (delegate && typeof delegate === "object") {
      current = delegate;
      continue;
    }
    break;
  }
  return current;
}

function hasDetachHandle(lifecycle: AgentRunLifecycle): boolean {
  return lifecycle.activeRunDetach$ != null;
}

function hasCompletionHandle(lifecycle: AgentRunLifecycle): boolean {
  return lifecycle.activeRunCompletionPromise != null;
}

async function waitUntil(
  isDone: () => boolean,
  deadline: number,
): Promise<void> {
  while (!isDone() && Date.now() < deadline) {
    await yieldMacrotask();
  }
}

/**
 * Await an in-flight run even when `activeRunCompletionPromise` is not
 * assigned yet. Callers that used to gate on
 * `isRunning && activeRunCompletionPromise` returned immediately during
 * `await onInitialize` and let a second send pre-empt the first.
 *
 * If the run ends (`isRunning` flips false) without ever exposing a
 * completion promise, this resolves so the caller can proceed.
 *
 * A proxied Intelligence connect mirrors `isRunning` but never assigns a
 * completion promise on the proxy. Waiting on that flag would hang for the
 * life of the stream; we stop once the handle owner already has handles
 * (or the bound expires) and only await a promise that lives on `agent`.
 */
export async function ɵawaitActiveRunSettlement(agent: object): Promise<void> {
  const lifecycle = asLifecycle(agent);
  const owner = runHandleOwner(agent);
  const ownerLife = asLifecycle(owner);
  const deadline = Date.now() + ON_INITIALIZE_HANDLE_WAIT_MS;

  await waitUntil(() => {
    if (hasCompletionHandle(lifecycle)) {
      return true;
    }
    if (
      owner !== agent &&
      (hasCompletionHandle(ownerLife) || hasDetachHandle(ownerLife))
    ) {
      return true;
    }
    return !lifecycle.isRunning && !ownerLife.isRunning;
  }, deadline);

  const completion = lifecycle.activeRunCompletionPromise;
  if (completion) {
    await completion;
  }
}

/**
 * `AbstractAgent.detachActiveRun` no-ops when `activeRunDetach$` is still
 * unset. Wait out the `onInitialize` window so a follow-up run actually
 * detaches instead of orphaning the first pipeline.
 *
 * The wait is keyed on the handle owner. A proxy that only mirrors
 * `isRunning` is ready as soon as its delegate has `activeRunDetach$`, and
 * `detachActiveRun` on the proxy already forwards to that delegate.
 */
export async function ɵdetachActiveRunWhenReady(agent: object): Promise<void> {
  const lifecycle = asLifecycle(agent);
  const owner = runHandleOwner(agent);
  const ownerLife = asLifecycle(owner);
  const deadline = Date.now() + ON_INITIALIZE_HANDLE_WAIT_MS;

  await waitUntil(() => {
    if (hasDetachHandle(lifecycle)) {
      return true;
    }
    if (owner !== agent && hasDetachHandle(ownerLife)) {
      return true;
    }
    return !lifecycle.isRunning && !ownerLife.isRunning;
  }, deadline);

  if (typeof lifecycle.detachActiveRun === "function") {
    await lifecycle.detachActiveRun();
  }
}
