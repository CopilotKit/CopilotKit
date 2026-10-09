"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
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
 * SECOND (and last) hand-synced copy of the exec skin's block-surface prefix.
 * The other is `src/skins/exec/blocks/build-block-ops.ts` — the write side,
 * which MINTS the ids. The shell must not import from `src/skins/` (skins are
 * plugins it does not know about), so the constant is kept in sync by hand;
 * `canvas-context.test.tsx` runs REAL minted ops through the classifier below
 * so either copy drifting fails a test rather than mis-routing a surface.
 *
 * The chat's reader (`src/shell/chat/inline-block-surface.tsx`) used to spell
 * it a third time and scan the ops its own way; it now consumes
 * `decideA2uiSurface` from here, so there is exactly ONE reader-side decision.
 */
export const BLOCK_SURFACE_PREFIX = "block:";

const A2UI_OPERATIONS_KEY = "a2ui_operations";

/**
 * The op containers a surfaceId can arrive on. Each op is searched across ALL
 * THREE, not `a ?? b ?? c`: `??` stops at the first container that merely
 * EXISTS, so an op carrying an empty `createSurface` beside an
 * `updateComponents` with a real id read as "no surface here" — the exact bug
 * `build-block-ops.ts`'s `extractSurfaceId` documents on the write side.
 */
const SURFACE_OP_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
] as const;

/** What an `a2ui-surface` activity's content means for the shared canvas. */
export type A2uiSurfaceClaim =
  /** A report surface: the canvas takes over the content region for it. */
  | "canvas"
  /** An exec `block:` tile: it renders inline in the transcript, not here. */
  | "inline-block"
  /** Junk, drift, or a shape nothing downstream can render: leave the page alone. */
  | "unclassifiable";

/**
 * THE single reader-side decision about an `a2ui-surface` activity — who owns
 * it, and (for the chat) which surface to mount.
 *
 * Both shell readers derive from this one call: the canvas asks for `claim`,
 * the chat's `InlineBlockSurface` asks for `blockSurfaceId`. They therefore
 * cannot disagree, which is what `src/app/[skin]/layout.tsx` relies on when it
 * dispatches an activity to exactly one of them.
 */
export interface A2uiSurfaceDecision {
  claim: A2uiSurfaceClaim;
  /**
   * The block surface to mount inline — non-null ONLY when the claim is
   * "inline-block" AND the ops were readable by plain property access, the way
   * `InlineBlockSurface` reads them. A stringified envelope classifies (so
   * drift cannot promote a tile into a page-blanking report) but yields no id:
   * an id with no readable ops would mount an empty card.
   */
  blockSurfaceId: string | null;
}

const UNCLASSIFIABLE: A2uiSurfaceDecision = {
  claim: "unclassifiable",
  blockSurfaceId: null,
};

/**
 * The ops array, but ONLY in the shape every downstream reader expects: plain
 * property access on an object, no parsing. Exported so the chat's card reads
 * the operations key through the same function that classified them, rather
 * than spelling `"a2ui_operations"` a second time on the read side.
 */
export function readableOperations(
  content: unknown,
): Record<string, unknown>[] | null {
  if (!content || typeof content !== "object") return null;
  const operations = (content as Record<string, unknown>)[A2UI_OPERATIONS_KEY];
  return Array.isArray(operations)
    ? (operations as Record<string, unknown>[])
    : null;
}

function decisionOf(
  operations: Record<string, unknown>[],
): A2uiSurfaceDecision {
  let firstBlockSurfaceId: string | null = null;
  // Scan EVERY op and every container, not just the first: the leading op of a
  // snapshot is routinely something else entirely (`beginRendering`), and a
  // single op can carry more than one container.
  for (const op of operations) {
    if (!op || typeof op !== "object") continue;
    for (const key of SURFACE_OP_KEYS) {
      const target = op[key] as { surfaceId?: unknown } | undefined;
      if (!target || typeof target !== "object") continue;
      const surfaceId = target.surfaceId;
      // typeof, not truthiness: a non-string id reaching `.startsWith` throws
      // mid-render, and neither reader has an error boundary above it.
      if (typeof surfaceId !== "string" || !surfaceId) continue;
      if (surfaceId.startsWith(BLOCK_SURFACE_PREFIX)) {
        firstBlockSurfaceId ??= surfaceId;
        continue;
      }
      // A non-block surface anywhere in the list is a report, and the canvas
      // takes the whole region — so the inline reader must stand down even if a
      // block id came first. One activity, one home.
      return { claim: "canvas", blockSurfaceId: null };
    }
  }
  return firstBlockSurfaceId
    ? { claim: "inline-block", blockSurfaceId: firstBlockSurfaceId }
    : UNCLASSIFIABLE;
}

/**
 * Decide who owns an `a2ui-surface` activity's content.
 *
 * Biased AGAINST the canvas on purpose. Claiming the canvas replaces the whole
 * content region with the active skin's `CanvasSurface` behind a bare "← Back";
 * a skin with no `CanvasSurface` (exec, bookstore) renders nothing at all, and a
 * skin that has one renders nothing when it cannot read the ops. So anything we
 * are not sure a downstream reader can render must NOT be a "canvas" claim — an
 * unparseable activity hijacking the page is a blank page.
 *
 * That is why a STRINGIFIED envelope never claims the canvas: every consumer
 * (each skin's `CanvasSurface`, `InlineBlockSurface`) reads
 * `content["a2ui_operations"]` by property access and parses nothing, so a
 * string is unrenderable by all of them. We still parse it far enough to
 * recognise a `block:` surface, so envelope drift cannot turn an inline tile
 * into a page-blanking "report" — but the tile gets no id to mount either.
 */
export function decideA2uiSurface(content: unknown): A2uiSurfaceDecision {
  const operations = readableOperations(content);
  if (operations) return decisionOf(operations);
  if (typeof content !== "string") return UNCLASSIFIABLE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return UNCLASSIFIABLE;
  }
  const parsedOperations = readableOperations(parsed);
  return parsedOperations &&
    decisionOf(parsedOperations).claim === "inline-block"
    ? { claim: "inline-block", blockSurfaceId: null }
    : UNCLASSIFIABLE;
}

/** Classify an `a2ui-surface` activity's content. See `decideA2uiSurface`. */
export function classifyA2uiSurface(content: unknown): A2uiSurfaceClaim {
  return decideA2uiSurface(content).claim;
}

/**
 * Narrow `agent.messages` without asserting. An absent agent (or an agent that
 * has not streamed yet) is the normal pre-run state and says nothing; a
 * PRESENT-but-not-an-array `messages` is envelope drift, which degrades to
 * "no surface detected" — and reports the offending type back so the provider
 * can say so in dev (see `useMessageDriftWarning`).
 */
function activityMessagesOf(messages: unknown): {
  activities: MaybeActivityMessage[];
  driftedType: string | null;
} {
  if (Array.isArray(messages))
    return {
      activities: messages as MaybeActivityMessage[],
      driftedType: null,
    };
  if (messages == null) return { activities: [], driftedType: null };
  return { activities: [], driftedType: typeof messages };
}

/**
 * Warn ONCE PER PROVIDER, in dev only, that `agent.messages` drifted.
 *
 * Once, because envelope drift is a standing condition and a per-render warning
 * would bury the console it is trying to be visible in. Per PROVIDER rather
 * than per module, because this module is evaluated once per server process: a
 * module-level latch would let the first SSR render that ever drifted silence
 * the warning for every request that process serves afterwards.
 *
 * Dev only: in production this is a silent degrade to "no surface detected".
 */
function useMessageDriftWarning(driftedType: string | null) {
  const warned = useRef(false);
  useEffect(() => {
    if (!driftedType || warned.current) return;
    if (process.env.NODE_ENV === "production") return;
    warned.current = true;
    console.warn(
      `[canvas-context] agent.messages is ${driftedType}, not an array — no canvas surface will be detected.`,
    );
  }, [driftedType]);
}

/**
 * Whether an `open-generative-ui` activity carries something `<OguiCanvas/>`
 * can actually render. It reads the streamed css/html/js off the content by
 * property access (via `useOguiSurface`, which passes `content ?? null`
 * straight through) and renders NOTHING without it — so an activity whose
 * content is missing, or is not an object to read fields off, must not claim
 * the region: that is a blank page behind a bare "← Back".
 */
function hasRenderableOguiContent(content: unknown): boolean {
  return !!content && typeof content === "object";
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
 * fall through to whatever earlier surface (or nothing) wins. An OGUI activity
 * is held to the same standard — one with no content to render is skipped, see
 * `hasRenderableOguiContent`.
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
  driftedType: string | null;
} {
  const { agent } = useAgent();
  const { activities, driftedType } = activityMessagesOf(agent?.messages);
  let latestOguiIsUnrenderable = false;
  for (let i = activities.length - 1; i >= 0; i--) {
    const m = activities[i];
    if (m?.role !== "activity") continue;
    if (m.activityType === "a2ui-surface") {
      if (classifyA2uiSurface(m.content) !== "canvas") continue;
      return {
        kind: "report",
        surfaceId: m.id ?? `a2ui-surface#${i}`,
        driftedType,
      };
    }
    if (m.activityType === "open-generative-ui") {
      // Same bias as the a2ui arm: an OGUI activity with nothing to render
      // falls through to whatever earlier surface (or nothing) wins, rather
      // than blanking the region behind a bare "← Back".
      //
      // And once the LATEST one is unrenderable, no EARLIER one may be claimed
      // either: `<OguiCanvas/>` renders whatever `useOguiSurface` finds last in
      // the stream, so claiming an older OGUI would put the region behind the
      // blank one anyway. An earlier REPORT is still fair game — that arm reads
      // its own content, not the OGUI stream.
      if (!hasRenderableOguiContent(m.content)) {
        latestOguiIsUnrenderable = true;
        continue;
      }
      if (latestOguiIsUnrenderable) continue;
      // An id-less OGUI activity still gets a surface id rather than null: the
      // generated UI is real and `<OguiCanvas/>` reads its content straight
      // from the stream, so returning null would both hide it AND discard any
      // earlier report surface this one supersedes.
      return {
        kind: "ogui",
        surfaceId: m.id ?? `open-generative-ui#${i}`,
        driftedType,
      };
    }
  }
  return { kind: null, surfaceId: null, driftedType };
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
  const { kind, surfaceId, driftedType } = useLatestCanvasSurface();
  useMessageDriftWarning(driftedType);
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
