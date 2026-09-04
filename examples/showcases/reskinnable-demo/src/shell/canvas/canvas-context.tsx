"use client";

import { createContext, useContext, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

type SurfaceKind = "report" | "ogui";

interface CanvasValue {
  activeSurfaceKind: SurfaceKind | null;
  activeSurfaceId: string | null;
  clear: () => void;
}

const CanvasContext = createContext<CanvasValue>({
  activeSurfaceKind: null,
  activeSurfaceId: null,
  clear: () => {},
});

/** Minimal shape of an activity message in the agent's message list. */
type MaybeActivityMessage = {
  id?: string;
  role?: string;
  activityType?: string;
  content?: unknown;
};

/**
 * THIRD hand-synced copy of the exec skin's block-surface prefix. The other two
 * are `src/skins/exec/blocks/build-block-ops.ts` (the write side, which MINTS
 * the ids) and `src/shell/chat/inline-block-surface.tsx` (the chat's read side,
 * which dispatches the inline renderer). The shell must not import from
 * `src/skins/`, and this module must not depend on the chat's renderer, so the
 * constant is kept in sync by hand rather than shared.
 */
const BLOCK_SURFACE_PREFIX = "block:";

const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** What an `a2ui-surface` activity's content means for the shared canvas. */
export type A2uiSurfaceClaim =
  /** A report surface: the canvas takes over the content region for it. */
  | "canvas"
  /** An exec `block:` tile: it renders inline in the transcript, not here. */
  | "inline-block"
  /** Junk, drift, or a shape nothing downstream can render: leave the page alone. */
  | "unclassifiable";

/** The ops array, but ONLY in the shape every downstream reader expects. */
function readableOperations(
  content: unknown,
): Record<string, unknown>[] | null {
  if (!content || typeof content !== "object") return null;
  const operations = (content as Record<string, unknown>)[A2UI_OPERATIONS_KEY];
  return Array.isArray(operations)
    ? (operations as Record<string, unknown>[])
    : null;
}

function claimOf(operations: Record<string, unknown>[]): A2uiSurfaceClaim {
  let sawBlockSurface = false;
  // Scan EVERY op, not just the first: a surfaceId can arrive on any of
  // createSurface / updateComponents / updateDataModel, and the leading op of a
  // snapshot is routinely something else entirely.
  for (const op of operations) {
    if (!op || typeof op !== "object") continue;
    const target = (op.createSurface ??
      op.updateComponents ??
      op.updateDataModel) as { surfaceId?: unknown } | undefined;
    const surfaceId = target?.surfaceId;
    if (typeof surfaceId !== "string" || !surfaceId) continue;
    if (surfaceId.startsWith(BLOCK_SURFACE_PREFIX)) {
      sawBlockSurface = true;
      continue;
    }
    return "canvas";
  }
  return sawBlockSurface ? "inline-block" : "unclassifiable";
}

/**
 * Classify an `a2ui-surface` activity's content.
 *
 * Biased AGAINST the canvas on purpose. Claiming the canvas replaces the whole
 * content region with the active skin's `CanvasSurface` behind a bare "← Back";
 * a skin with no `CanvasSurface` (exec, bookstore) renders nothing at all, and a
 * skin that has one renders nothing when it cannot read the ops. So anything we
 * are not sure a downstream reader can render must NOT be a "canvas" claim — an
 * unparseable activity hijacking the page is a blank page.
 *
 * That is why a STRINGIFIED envelope never returns "canvas": every consumer
 * (each skin's `CanvasSurface`, `InlineBlockSurface`) reads
 * `content["a2ui_operations"]` by property access and parses nothing, so a
 * string is unrenderable by all of them. We still parse it far enough to
 * recognise a `block:` surface, so envelope drift cannot turn an inline tile
 * into a page-blanking "report".
 */
export function classifyA2uiSurface(content: unknown): A2uiSurfaceClaim {
  const operations = readableOperations(content);
  if (operations) return claimOf(operations);
  if (typeof content !== "string") return "unclassifiable";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "unclassifiable";
  }
  const parsedOperations = readableOperations(parsed);
  return parsedOperations && claimOf(parsedOperations) === "inline-block"
    ? "inline-block"
    : "unclassifiable";
}

/**
 * One-shot latch: envelope drift is a standing condition, so warning per render
 * would bury the console it is trying to be visible in.
 */
let warnedAboutMessageDrift = false;

/**
 * Narrow `agent.messages` without asserting. An absent agent (or an agent that
 * has not streamed yet) is the normal pre-run state and says nothing; a
 * PRESENT-but-not-an-array `messages` is envelope drift, which degrades to
 * "no surface detected" — but says so once, loudly, rather than silently.
 */
function activityMessagesOf(messages: unknown): MaybeActivityMessage[] {
  if (Array.isArray(messages)) return messages as MaybeActivityMessage[];
  if (messages == null) return [];
  if (!warnedAboutMessageDrift && process.env.NODE_ENV !== "production") {
    warnedAboutMessageDrift = true;
    console.warn(
      `[canvas-context] agent.messages is ${typeof messages}, not an array — no canvas surface will be detected.`,
    );
  }
  return [];
}

/**
 * The latest canvas surface (report or OGUI) in the stream, whichever is most
 * recent. Generic: it keys off the activity type, the message id and the SHAPE
 * of the activity content — never off a skin's catalog, so it works for any
 * skin without knowing one.
 *
 * Content matters because `a2ui-surface` carries two different things. An exec
 * `block:` surface is NOT a canvas event: it renders where the activity sits in
 * the transcript (`<InlineBlockSurface/>`). Claiming one here would flip the
 * whole content region into a report frame — blank for any skin without a
 * `CanvasSurface` — and bury the page behind a bare "← Back". So only content
 * that classifies as "canvas" is claimed; a block surface, junk, and drift all
 * fall through to whatever earlier surface (or nothing) wins.
 *
 * A surface with no message id gets a fallback derived from its POSITION in the
 * stream rather than a constant, so two id-less surfaces never collide — see
 * the dismiss-latch invariant on `CanvasProvider`. Positions are stable for
 * already-streamed messages (the list only grows at the end), which is exactly
 * the lifetime the latch needs.
 */
function useLatestCanvasSurface(): {
  kind: SurfaceKind | null;
  surfaceId: string | null;
} {
  const { agent } = useAgent();
  const messages = activityMessagesOf(agent?.messages);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "activity") continue;
    if (m.activityType === "a2ui-surface") {
      if (classifyA2uiSurface(m.content) !== "canvas") continue;
      return { kind: "report", surfaceId: m.id ?? `a2ui-surface#${i}` };
    }
    if (m.activityType === "open-generative-ui") {
      // An id-less OGUI activity still gets a surface id rather than null: the
      // generated UI is real and `<OguiCanvas/>` reads its content straight
      // from the stream, so returning null would both hide it AND discard any
      // earlier report surface this one supersedes.
      return { kind: "ogui", surfaceId: m.id ?? `open-generative-ui#${i}` };
    }
  }
  return { kind: null, surfaceId: null };
}

/**
 * Tracks whether a surface (A2UI report or OGUI) should occupy the content
 * region, and which KIND. Derives from the latest surface activity in the
 * agent's message stream and layers a local dismiss for the "← Back" control.
 *
 * The dismiss latch stores the dismissed surface's id, and every surface has a
 * distinct one (message id, else a position-derived fallback), so dismissing
 * one surface never suppresses a later one.
 */
export function CanvasProvider({ children }: { children: React.ReactNode }) {
  const { kind, surfaceId } = useLatestCanvasSurface();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const active = !!surfaceId && surfaceId !== dismissedId;
  const activeSurfaceId = active ? surfaceId : null;
  const activeSurfaceKind = active ? kind : null;

  const clear = () => setDismissedId(surfaceId);

  return (
    <CanvasContext.Provider
      value={{ activeSurfaceKind, activeSurfaceId, clear }}
    >
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas(): CanvasValue {
  return useContext(CanvasContext);
}
