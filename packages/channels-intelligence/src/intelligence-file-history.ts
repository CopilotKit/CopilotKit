import type { AgentContentPart } from "@copilotkit/channels-ui";
import type { AgentMessage } from "./transports.js";
import type { ChannelFileRef, EgressRoute } from "./contracts.js";
import { buildContentParts } from "./content-parts.js";

/**
 * Shared file/history client used by BOTH transports — the HTTP polling
 * {@link ../http-transports} and the realtime gateway
 * {@link ../realtime-gateway-transport}. These three operations are HTTP-only:
 * the gateway relays the render-event STREAM but never file bytes or history
 * (bytes don't belong on the control socket), so a realtime deployment reaches
 * the same app-api REST endpoints directly. Extracting them here keeps the two
 * paths byte-identical — the OSS-476 parity guarantee — instead of the realtime
 * path silently degrading (no history, no inbound file bytes, no upload).
 */

/** Hard cap on an inbound file download (mirrors the app-api serve route). */
const MAX_INBOUND_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Read a response body into memory, aborting once `cap` bytes are exceeded — so
 * a response with no or understated `content-length` (chunked transfer, or a
 * misbehaving/anomalous server) cannot pull an unbounded body into memory. Falls
 * back to a buffered `arrayBuffer()` read with a post-read size check when the
 * response exposes no readable stream (e.g. a mocked Response in tests).
 */
async function readCapped(
  res: Response,
  cap: number,
  handle: string,
): Promise<Uint8Array> {
  const body = res.body;
  if (!body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > cap) {
      throw new Error(
        `intelligence file ${handle} too large: ${buf.byteLength} bytes > ${cap} cap`,
      );
    }
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new Error(
        `intelligence file ${handle} too large: exceeded ${cap} byte cap`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The minimal app-api HTTP coordinates the file/history calls need. */
export interface IntelligenceFileHistoryConfig {
  /** Intelligence app-api base URL, e.g. `http://localhost:7050`. */
  baseUrl: string;
  /** Project runtime API key (`cpk-…`), sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Optional diagnostic sink for best-effort degradation. */
  log?: (msg: string, meta?: unknown) => void;
  /**
   * Injectable full `fetch` for the binary download / history / upload paths.
   * These need a binary-capable client (`.body`/`.arrayBuffer()`/`.headers`/
   * `.json()`), which the transport's text-only `FetchLike` cannot satisfy, so
   * this is its OWN injectable rather than a reuse of the transport's fetch.
   * Defaults to the global `fetch` when omitted.
   */
  fetch?: typeof fetch;
}

/**
 * Credentialed client for app-api's file-serve, history, and file-upload
 * routes. Instantiated by each transport from its own app-api coordinates.
 */
export class IntelligenceFileHistoryClient {
  constructor(private readonly cfg: IntelligenceFileHistoryConfig) {}

  /**
   * Resolve the binary-capable fetch: the injected `config.fetch` when present,
   * else the global `fetch`. `undefined` on a runtime with neither (each caller
   * handles that per its own degrade/throw contract).
   */
  private resolveFetch(): typeof fetch | undefined {
    return (
      this.cfg.fetch ??
      (globalThis as unknown as { fetch?: typeof fetch }).fetch
    );
  }

  /**
   * Download an inbound file's raw bytes by handle from app-api's file-serve
   * route. Uses the global `fetch` directly (not a JSON helper) so the binary
   * body survives via `arrayBuffer()`. Auth is the same runtime bearer.
   */
  async fetchFile(
    handle: string,
  ): Promise<{ bytes: Uint8Array; mimeType?: string }> {
    const gfetch = this.resolveFetch();
    if (!gfetch) {
      throw new Error(
        "intelligenceAdapter: no global fetch available for file download",
      );
    }
    const url = `${this.cfg.baseUrl}/api/channels/files/${encodeURIComponent(handle)}`;
    const res = await gfetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${this.cfg.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`intelligence file ${handle} -> ${res.status}`);
    }
    // Fast reject on an advertised oversize length…
    const declaredLen = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLen) && declaredLen > MAX_INBOUND_FILE_BYTES) {
      throw new Error(
        `intelligence file ${handle} too large: ${declaredLen} bytes > ${MAX_INBOUND_FILE_BYTES} cap`,
      );
    }
    // …but the declared length is not trustworthy (absent on chunked transfer,
    // or understated by a misbehaving/anomalous server), so bound the ACTUAL
    // read: stream the body and abort once the cap is exceeded rather than
    // pulling an unbounded response into memory via arrayBuffer().
    const bytes = await readCapped(res, MAX_INBOUND_FILE_BYTES, handle);
    const mimeType = res.headers.get("content-type") ?? undefined;
    return { bytes, mimeType };
  }

  /**
   * Fetch prior thread turns from app-api's channel history route for
   * conversation-history seeding. A root-level turn (no thread anchor) has no
   * prior thread to look up, so this returns `[]` without a request.
   * Best-effort like {@link fetchFile}'s sibling paths — any non-2xx response
   * or thrown error degrades to `[]`; missing history must never fail the turn.
   * Logging is split by failure class: a 4xx (except 429) is a permanent
   * misconfiguration (route not mounted / wrong baseUrl / bad runtime key) and
   * is logged loudly and distinctly so it doesn't hide forever; a 5xx, 429, or
   * thrown network error is a transient blip and gets the quiet degradation log.
   */
  async getHistory(
    replyTarget: EgressRoute,
    limit: number,
  ): Promise<AgentMessage[]> {
    // Provider-specific history query. `EgressRoute` is opaque, so each adapter
    // maps its route → app-api's `/api/channels/history` query here, mirroring
    // `conversationKeyFromReplyTarget`'s per-adapter switch. Slack keys off
    // `threadTs`; Teams off `tenantId`+`conversationId` (matching app-api's
    // `teams:{tenantId}:{conversationId}` thread_key). A turn with no thread
    // anchor has no prior history to look up, so return `[]`.
    const rt = replyTarget as
      | {
          adapter?: string;
          teamId?: string;
          channel?: string;
          threadTs?: string;
          tenantId?: string;
          conversationId?: string;
        }
      | undefined;
    let qs: URLSearchParams;
    if (rt?.adapter === "teams") {
      if (!rt.tenantId || !rt.conversationId) return [];
      qs = new URLSearchParams({
        adapter: "teams",
        tenantId: rt.tenantId,
        conversationId: rt.conversationId,
        limit: String(limit),
      });
    } else {
      if (!rt?.threadTs) return [];
      qs = new URLSearchParams({
        teamId: rt.teamId ?? "",
        channel: rt.channel ?? "",
        threadTs: rt.threadTs,
        limit: String(limit),
      });
    }
    try {
      const gfetch = this.resolveFetch();
      if (!gfetch) {
        this.cfg.log?.("intelligence history fetch: no global fetch available");
        return [];
      }
      const url = `${this.cfg.baseUrl}/api/channels/history?${qs.toString()}`;
      const res = await gfetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${this.cfg.apiKey}` },
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // A permanent misconfiguration (missing route, wrong baseUrl, bad
          // runtime key) looks identical to a transient blip unless it's
          // called out distinctly — surface it loudly so it doesn't hide
          // forever behind the best-effort degrade-to-`[]` below.
          this.cfg.log?.(
            `[intelligence] getHistory ${res.status} for thread history — likely a misconfigured/unauthorized history endpoint (baseUrl/route/apiKey); Channel Bot will run WITHOUT prior-turn history`,
          );
        } else {
          // Transient (5xx/429) — quiet best-effort degradation, history is
          // just skipped for this turn.
          this.cfg.log?.(`intelligence history fetch -> ${res.status}`);
        }
        return [];
      }
      const json = (await res.json()) as {
        messages?: Array<{
          id: string;
          role: "user" | "assistant";
          text: string;
          files?: ChannelFileRef[];
        }>;
      };
      // Cap to the most recent `limit` BEFORE hydrating file bytes: an
      // over-returning route must not make us download attachments for messages
      // we'd immediately discard, and `limit <= 0` means "no history" (a raw
      // `slice(-0)` would otherwise return the ENTIRE array).
      const capped = limit <= 0 ? [] : (json.messages ?? []).slice(-limit);
      const out: AgentMessage[] = [];
      for (const m of capped) {
        if (!m.files?.length) {
          out.push({ id: m.id, role: m.role, content: m.text ?? "" });
          continue;
        }
        // Hydrate historical file refs with the SAME logic as the live inbound
        // turn path, so a past image attachment and a live one produce
        // identical content parts (e.g. "what was the image I sent?" works).
        const fileParts = await buildContentParts(
          m.files,
          this.fetchFile.bind(this),
          this.cfg.log,
        );
        const content: AgentContentPart[] = [];
        if (m.text) content.push({ type: "text", text: m.text });
        content.push(...fileParts);
        out.push({ id: m.id, role: m.role, content });
      }
      // Already capped to the most recent `limit` above (before hydration).
      return out;
    } catch (err) {
      this.cfg.log?.("intelligence history fetch failed", err);
      return [];
    }
  }

  /**
   * Stream an outbound file's bytes to app-api's per-delivery upload route
   * (lease-scoped) ahead of a `file` render frame. Returns the storage handle
   * the frame references. Bytes go as the raw request body; display metadata
   * rides query params.
   */
  async uploadFile(
    deliveryId: string,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ handle: string }> {
    const gfetch = this.resolveFetch();
    if (!gfetch) {
      throw new Error(
        "intelligenceAdapter: no global fetch available for file upload",
      );
    }
    const qs = new URLSearchParams({ filename: args.filename });
    if (args.title) qs.set("title", args.title);
    if (args.altText) qs.set("altText", args.altText);
    const url = `${this.cfg.baseUrl}/api/channels/deliveries/${encodeURIComponent(
      deliveryId,
    )}/files?${qs.toString()}`;
    const res = await gfetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        "content-type": "application/octet-stream",
      },
      // The runtime (undici) sends the Uint8Array bytes verbatim; the static
      // `fetch` body type differs across this package's dom vs node-only lib
      // configs, so bridge with a portable cast (`string` is a valid body in
      // both). The value is never actually a string at runtime.
      body: args.bytes as unknown as string,
    });
    if (!res.ok) {
      throw new Error(`intelligence file upload -> ${res.status}`);
    }
    const json = (await res.json()) as { handle?: string };
    if (!json.handle) {
      throw new Error("intelligence file upload: response missing handle");
    }
    return { handle: json.handle };
  }
}
