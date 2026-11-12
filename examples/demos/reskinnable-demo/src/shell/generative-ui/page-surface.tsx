"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  GenerativeUISurface,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/generative-ui";
import { useCopilotChatConfiguration } from "@copilotkit/react-core";
import {
  pageSurfaceContent,
  type SurfaceOperation,
} from "./page-surface-content";

/** Thread used when the chat has no thread yet (only reachable in tests). */
const FALLBACK_THREAD_ID = "page-surfaces";

/**
 * Renders A2UI operations on a named place of the page, outside the chat.
 *
 * This is the 2.0 home of what the app did with a private `<A2UIProvider>` and
 * `processMessages` in 1.x. Generative UI keeps one surface manager per
 * `CopilotKitProvider` (`generativeUI={{ ui }}`), and `<GenerativeUISurface id>`
 * shows the surface whose target is `id`. The agent's v0.9 surfaces reach the
 * browser as `generative-ui-surface` activities that target the chat, so the
 * page renders a COPY of the ops, re-addressed to its own target: the chat's
 * copy (behind the shell's handoff pill) and the page's copy never collide.
 *
 * The copy goes into the chat's current thread, which is also made the
 * active thread: `<GenerativeUISurface>` reads the active thread, and the
 * framework only sets it when a run starts, so a page that renders before
 * the first run (exec's pinned blocks) or a reloaded thread would show
 * nothing.
 *
 * Ingesting the same ops again is a no-op, so this is safe to re-render.
 */
export function PageSurface({
  target,
  operations,
  className,
  fallback,
  renderRejected,
}: {
  /** Unique per place on the page, e.g. `canvas:banking` or `block:abc`. */
  target: string;
  operations: readonly SurfaceOperation[];
  className?: string;
  fallback?: ReactNode;
  /**
   * Shown above the surface when the browser rejected some of its ops (an
   * unknown component, a prop of the wrong type, a wrong catalog id). Gets the
   * validator's reasons. Without it, a rejected op is only reported to the
   * console and the inspector.
   */
  renderRejected?: (reasons: string[]) => ReactNode;
}) {
  const { available, rejected } = usePageSurface(target, operations);
  if (!available) return <>{fallback ?? null}</>;
  return (
    <>
      {renderRejected && rejected.length > 0 ? renderRejected(rejected) : null}
      <GenerativeUISurface
        id={target}
        className={className}
        fallback={fallback}
        autoScroll={false}
      />
    </>
  );
}

/**
 * The work of `<PageSurface>` without the rendering: hands `operations` to the
 * surface manager under `target`, and returns the validator's reasons for any
 * op the browser rejected. Render `<GenerativeUISurface id={target}>` where the
 * surface goes. For a caller that shows something INSTEAD of the surface when
 * it failed (keel's full-region error panel).
 *
 * `available` is false outside a provider with `generativeUI`.
 */
export function usePageSurface(
  target: string,
  operations: readonly SurfaceOperation[],
): { available: boolean; rejected: string[] } {
  const runtime = useGenerativeUIRuntime();
  const manager = runtime?.manager;
  const chatThreadId = useCopilotChatConfiguration()?.threadId;
  // Re-render on every change of the surface manager, so `rejected` is fresh.
  useSyncExternalStore(
    manager?.subscribe ?? noSubscription,
    manager?.getVersion ?? noVersion,
    noVersion,
  );
  // Keyed on the serialized ops: activity snapshots hand over a new array with
  // the same ops on every message update.
  const opsKey = JSON.stringify(operations);
  const content = useMemo(
    () => pageSurfaceContent(JSON.parse(opsKey), target),
    [opsKey, target],
  );
  const threadId =
    chatThreadId ?? manager?.getActiveThread() ?? FALLBACK_THREAD_ID;

  useLayoutEffect(() => {
    if (!manager || !content) return;
    manager.setActiveThread(threadId);
    manager.ingest(threadId, undefined, content);
  }, [manager, threadId, content]);

  if (!manager) return { available: false, rejected: [] };
  const surface =
    manager.getSurface(threadId, target) ??
    manager.getFailedSurface(threadId, target);
  const rejected = surface
    ? [...surface.serverRejected, ...surface.clientRejected].map(
        (entry) => entry.reason,
      )
    : [];
  return { available: true, rejected };
}

const noSubscription = () => () => {};
const noVersion = () => 0;
