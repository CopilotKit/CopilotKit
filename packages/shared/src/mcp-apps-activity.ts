import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import { z } from "zod";

// Bridge-free MCP Apps activity surface: the activity type, the content schema,
// and the `ui/message` follow-up runner. It lives in `@copilotkit/shared` (a
// dependency of every frontend) rather than in `@copilotkit/mcp-apps-renderer`,
// so registering the activity does not require the renderer package to be
// installed. The renderer is an OPTIONAL peer: only apps that actually render
// an MCP App need it, and they load its bridge lazily via `import()`.

/**
 * Activity type for MCP Apps events - must match the middleware's MCPAppsActivityType.
 */
export const MCPAppsActivityType = "mcp-apps";

// Keep this surface bridge-free: the MCP SDK is only used as a test oracle.
// This is the Angular host's content contract, expressed using our zod API.
const looseObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).passthrough();

// `_meta` is an extension channel, so its CONTENTS stay unconstrained - but the
// SDK still requires it to be an object, and a string or array there is a bug
// worth catching rather than forwarding.
const metaSchema = z.record(z.string(), z.unknown());

const annotationsSchema = looseObject({
  audience: z.array(z.enum(["user", "assistant"])).optional(),
  priority: z.number().min(0).max(1).optional(),
  lastModified: z.string().optional(),
});

// Validated by decoding, mirroring the MCP SDK's own base64 check, rather than
// by pattern. The pattern this replaces additionally required canonical padding,
// which the SDK does not: it accepts an unpadded payload that we rejected. Since
// one bad block fails the whole content array, that cost the entire widget.
const base64Schema = z.string().refine((value) => {
  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}, "Expected base64-encoded data");

const resourceContentsSchema = z.union([
  looseObject({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string(),
    _meta: metaSchema.optional(),
  }),
  looseObject({
    uri: z.string(),
    mimeType: z.string().optional(),
    blob: base64Schema,
    _meta: metaSchema.optional(),
  }),
]);

const contentItemSchema = z.discriminatedUnion("type", [
  looseObject({
    type: z.literal("text"),
    text: z.string(),
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
  }),
  looseObject({
    type: z.literal("image"),
    data: base64Schema,
    mimeType: z.string(),
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
  }),
  looseObject({
    type: z.literal("audio"),
    data: base64Schema,
    mimeType: z.string(),
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
  }),
  looseObject({
    type: z.literal("resource"),
    resource: resourceContentsSchema,
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
  }),
  looseObject({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
  }),
]);

const callToolResultSchema = looseObject({
  content: z.array(contentItemSchema).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

/** Activity input accepts an omitted result.content; validation defaults it to []. */
export const MCPAppsActivityContentSchema = looseObject({
  result: callToolResultSchema,
  resourceUri: z.string(),
  serverHash: z.string(),
  serverId: z.string().optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

// Keep the public input contract compatible with structured-only results.
// Parsed output is normalized before it crosses the bridge.
export type MCPAppsActivityContent = z.input<
  typeof MCPAppsActivityContentSchema
>;

/**
 * The subset of `CopilotKitCore` that {@link ɵrunMcpFollowUp} depends on.
 * Declared structurally so the runner can be unit-tested without a full core.
 */
export interface ɵMcpFollowUpHost {
  runAgent(params: { agent: AbstractAgent }): Promise<RunAgentResult>;
}

/**
 * Run an MCP app `ui/message` follow-up, scoped to the thread it was enqueued
 * for (issue #5819).
 *
 * The MCP request queue delays follow-up work until the agent is idle. There is
 * a single shared registry agent per id, and switching threads overwrites its
 * `threadId`/`messages` in place. So if the host switches threads while a
 * follow-up is queued, running it now would execute against — and stream into —
 * the now-foreground thread.
 *
 * - **Same thread** (the common case): run on the shared agent, unchanged.
 * - **Thread changed**: the shared agent has moved on, so the follow-up can no
 *   longer run in its originating thread's context. Drop it rather than leak it
 *   into the current thread. (The MCP app already received its `ui/message` ack
 *   at enqueue time; only the optional agent turn is skipped.)
 *
 * @internal exported for testing.
 */
export async function ɵrunMcpFollowUp({
  host,
  agent,
  capturedThreadId,
}: {
  host: ɵMcpFollowUpHost;
  agent: AbstractAgent;
  capturedThreadId: string;
}): Promise<RunAgentResult> {
  const currentThreadId = agent.threadId || "default";
  const originThreadId = capturedThreadId || "default";

  if (currentThreadId === originThreadId) {
    return host.runAgent({ agent });
  }

  console.warn(
    "[MCPAppsRenderer] ui/message follow-up dropped: the thread changed " +
      `(${originThreadId} → ${currentThreadId}) between enqueue and execution, ` +
      "so running it would leak into the now-foreground thread.",
  );
  return { result: undefined, newMessages: [] };
}
