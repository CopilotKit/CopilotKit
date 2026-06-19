import { z } from "zod";

// ---------------------------------------------------------------------------
// Outbound (main → extension) types
// ---------------------------------------------------------------------------

export type BridgeMethod = "readActiveTab" | "click" | "fill" | "navigate";

export interface BridgeRequest {
  type: "request";
  id: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Inbound (extension → main) Zod schemas
// ---------------------------------------------------------------------------

const ResultReply = z.object({
  type: z.literal("result"),
  id: z.string(),
  data: z.unknown(),
});

const ErrorReply = z.object({
  type: z.literal("error"),
  id: z.string(),
  message: z.string(),
});

const Ping = z.object({
  type: z.literal("ping"),
});

const Inbound = z.union([ResultReply, ErrorReply, Ping]);

// ---------------------------------------------------------------------------
// Exported inbound types
// ---------------------------------------------------------------------------

export type BridgeReply =
  | z.infer<typeof ResultReply>
  | z.infer<typeof ErrorReply>;

export type BridgeInbound = z.infer<typeof Inbound>;

// ---------------------------------------------------------------------------
// parseInbound
// ---------------------------------------------------------------------------

/**
 * Parse a raw WebSocket message string into a {@link BridgeInbound} value.
 *
 * Throws when:
 * - `raw` is not valid JSON
 * - The parsed object does not match any of the known inbound shapes
 */
export function parseInbound(raw: string): BridgeInbound {
  return Inbound.parse(JSON.parse(raw)) as BridgeInbound;
}
