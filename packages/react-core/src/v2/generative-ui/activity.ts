import { useLayoutEffect, useMemo } from "react";
import { z } from "zod";
import type {
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import { withCause } from "./boundaries";
import { useManagerVersion } from "./hooks";
import type { GenerativeUIRuntime } from "./runtime-context";

/**
 * The content of a generative UI surface activity message. A missing
 * `rejected` reads as []. Extra keys of the content are kept.
 */
export const GenerativeUISurfaceContentSchema = z
  .object({
    surfaceId: z.string(),
    target: z.string(),
    catalogId: z.string(),
    operations: z.array(z.any()),
    status: z.enum(["streaming", "ready", "error"]),
    rejected: z
      .array(z.object({ index: z.number(), reason: z.string() }))
      .default([]),
  })
  .passthrough();

/** The content of a surface activity message, or the issues that make it malformed. */
export type ParsedGenerativeUISurfaceContent =
  | { content: GenerativeUISurfaceContent; issues?: undefined }
  | { content?: undefined; issues: string[] };

/** A zod issue path as `rejected[0].index`; the content itself is "content". */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const segment of path) {
    out +=
      typeof segment === "number"
        ? `[${segment}]`
        : `${out ? "." : ""}${String(segment)}`;
  }
  return out || "content";
}

/**
 * Reads the content of a surface activity message with
 * {@link GenerativeUISurfaceContentSchema}, or lists its issues (as
 * `path: message`) when it is malformed. Never throws.
 */
export function parseGenerativeUISurfaceContent(
  content: unknown,
): ParsedGenerativeUISurfaceContent {
  let result: ReturnType<typeof GenerativeUISurfaceContentSchema.safeParse>;
  try {
    result = GenerativeUISurfaceContentSchema.safeParse(content);
  } catch {
    // A getter or a Proxy trap of the content threw while it was read.
    return { issues: ["content: could not be read"] };
  }
  if (result.success) {
    return { content: result.data as unknown as GenerativeUISurfaceContent };
  }
  return {
    issues: result.error.issues.map(
      (issue) => `${formatPath(issue.path)}: ${issue.message}`,
    ),
  };
}

/**
 * The rejected operations of a surface (the runtime's first, then the
 * client's) and the error that goes with them, for a wrapper: a generic
 * message, with the same list as its `cause`. The `cause` is not enumerable,
 * so `JSON.stringify`, a spread and error reporters leave the list out.
 * `clientRejected` is appended to in place by the manager, so its length is
 * part of the key.
 */
export function useGenerativeUIRejected(
  serverRejected: readonly GenerativeUIRejectedOperation[] | undefined,
  clientRejected: readonly GenerativeUIRejectedOperation[] | undefined,
): { rejected: GenerativeUIRejectedOperation[]; error: Error | undefined } {
  const clientRejectedCount = clientRejected?.length ?? 0;
  const rejected = useMemo(
    () => [...(serverRejected ?? []), ...(clientRejected ?? [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverRejected, clientRejected, clientRejectedCount],
  );
  const error = useMemo(
    () =>
      rejected.length
        ? withCause(
            new Error(`${rejected.length} UI update(s) could not be shown`),
            rejected,
          )
        : undefined,
    [rejected],
  );
  return { rejected, error };
}

/**
 * What a renderer of one surface activity message shows: the surface (or the
 * failed surface whose `createSurface` was rejected), and its rejected
 * operations with their error (see {@link useGenerativeUIRejected}). It
 * ingests `content` into the manager (idempotent: the root ingests the
 * agent's messages too, and this covers an agent the root has not seen yet),
 * and renders again on every change of the manager.
 *
 * `surface` is undefined when there is no runtime, thread or content, when
 * the surface's target is not `target`, or when the surface does not exist
 * (the agent deleted it). Both rejected lists cover only the latest
 * `render_ui` call (see the manager's ingest).
 */
export function useGenerativeUIActivitySurface({
  runtime,
  threadId,
  agentId,
  content,
  target,
}: {
  runtime: GenerativeUIRuntime | null;
  threadId: string | undefined;
  agentId: string | undefined;
  /** The parsed content; undefined when it is malformed. */
  content: GenerativeUISurfaceContent | undefined;
  /** The target whose surfaces this renderer shows. */
  target: string;
}): {
  surface: ManagedSurface | undefined;
  rejected: GenerativeUIRejectedOperation[];
  error: Error | undefined;
} {
  useManagerVersion(runtime);
  useLayoutEffect(() => {
    if (runtime && threadId && content) {
      runtime.manager.ingest(threadId, agentId, content);
    }
  }, [runtime, threadId, agentId, content]);
  const surface =
    runtime && threadId && content && content.target === target
      ? // A surface whose createSurface was rejected shows only the error.
        (runtime.manager.getSurface(threadId, content.surfaceId) ??
        runtime.manager.getFailedSurface(threadId, content.surfaceId))
      : undefined;
  const { rejected, error } = useGenerativeUIRejected(
    content?.rejected,
    surface?.clientRejected,
  );
  return { surface, rejected, error };
}
