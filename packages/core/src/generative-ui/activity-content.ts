import { z } from "zod";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";

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
