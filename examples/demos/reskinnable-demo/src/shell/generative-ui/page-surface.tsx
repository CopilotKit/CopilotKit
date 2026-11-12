"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  GenerativeUISurface,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/generative-ui";
import { useCopilotChatConfiguration } from "@copilotkit/react-core";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";

/** An A2UI operation as the app reads it: v0.9 or 1.0, not yet checked. */
export type SurfaceOperation = Record<string, unknown>;

/** The op containers that carry a `surfaceId`. */
const SURFACE_OP_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

/** Thread used when the chat has no thread yet (only reachable in tests). */
const FALLBACK_THREAD_ID = "page-surfaces";

/**
 * A v0.9 dynamic value as A2UI 1.0: `{ path }` becomes `{ "@path" }`, at any
 * depth. Literals stay. The app's op builders emit literals only, so this is
 * defensive: the runtime converts the agent's v0.9 surfaces itself, and only
 * ops the app builds and renders without a run (exec's pinned blocks) pass
 * through here as v0.9.
 */
function upgradeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && typeof record.path === "string") {
    return { "@path": record.path };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, upgradeValue(item)]),
  );
}

/**
 * The content of a page-owned surface: `operations` (v0.9 or 1.0) as A2UI 1.0
 * operations for the surface `target`. Every op is re-addressed to `target`,
 * so the copy never collides with the surface the agent's run created (the
 * chat owns that one, under the original id). Returns null when no op names
 * a surface.
 *
 * Exported for tests.
 */
export function pageSurfaceContent(
  operations: readonly SurfaceOperation[],
  target: string,
): GenerativeUISurfaceContent | null {
  let catalogId = "";
  const upgraded: A2UIOperation[] = [];
  for (const op of operations) {
    if (!op || typeof op !== "object") continue;
    const key = SURFACE_OP_KEYS.find(
      (name) => op[name] && typeof op[name] === "object",
    );
    if (!key) continue;
    const payload = op[key] as Record<string, unknown>;
    const isV09 = op.version !== "1.0";
    if (key === "createSurface" && typeof payload.catalogId === "string") {
      catalogId ||= payload.catalogId;
    }
    const next: Record<string, unknown> = { ...payload, surfaceId: target };
    if (isV09 && key === "updateComponents") {
      next.components = upgradeValue(payload.components);
    }
    upgraded.push({ version: "1.0", [key]: next } as A2UIOperation);
  }
  if (!upgraded.length) return null;
  return {
    surfaceId: target,
    target,
    catalogId,
    operations: upgraded,
    status: "ready",
    rejected: [],
  };
}

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
