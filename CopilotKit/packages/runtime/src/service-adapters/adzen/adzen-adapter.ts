/**
 * Copilot Runtime adapter for AdZen.
 *
 * This adapter is a lightweight passthrough adapter that intercepts and forwards
 * each streamed chunk from an upstream CopilotKit-compatible adapter to an external
 * AdZen endpoint.
 *
 * ## Example
 *
 * ```ts
 * const openaiAdapter = new OpenAIAdapter({ openai: new OpenAI() });
 * const serviceAdapter = AdzenAdapter.create(openaiAdapter, {
 *   apiKey: "<your-adzen-api-key>",
 *   debug: true,
 * });
 * ```
 */

import { randomUUID } from "@copilotkit/shared";

export interface AdzenConfig {
  /** When true, log each chunk sent and the response content */
  debug?: boolean;
  /** API key for AdZen endpoint authentication */
  apiKey: string;
}

const ADZEN_ENDPOINT = "https://agp.adzen.ai/v1/messages/stream";

// Common paths used by CopilotKit-compatible adapters to store textual content inside a stream chunk
const CONTENT_PATHS = [
  "choices[0].delta.content", // OpenAI streaming
  "choices[0].message.content", // OpenAI non-stream / Anthropic
  "completion", // Anthropic (Claude) streaming
  "text", // Grok, Llama, etc.
  "content", // generic fallback
];

export class AdzenAdapter {
  constructor(
    private upstreamAdapter: any,
    private config: AdzenConfig,
  ) {
    if (!upstreamAdapter) throw new Error("AdZen: upstream adapter is required");

    // Ensure we have authentication for the AdZen endpoint
    if (!config.apiKey) {
      throw new Error("AdZen: apiKey is required in config");
    }
  }

  /**
   * Forward a single chunk to the third-party endpoint. Failures are swallowed –
   * we never want to interrupt the primary stream.
   */
  private async forwardChunk(chunk: any, streamId?: string, chunkId?: number): Promise<string> {
    // Fast-lane for sentinel tokens used by some providers
    if (chunk === "[DONE]") return chunk;

    // Try to parse chunk as JSON so we can surgically replace content
    let parsed: any | undefined;
    if (typeof chunk === "string" && chunk.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(chunk);
      } catch {}
    }

    // Determine the content string to send
    let contentToSend: string = typeof chunk === "string" ? chunk : String(chunk);
    let contentPath: string | undefined;

    if (parsed) {
      for (const p of CONTENT_PATHS) {
        const v = getNested(parsed, p);
        if (typeof v === "string") {
          contentToSend = v;
          contentPath = p;
          break;
        }
      }
    }

    // Debug – show original content being sent
    if (this.config.debug) {
      console.log(
        `[AdZen] copilotkit → adzen (stream ${streamId ?? "n/a"}, chunk ${chunkId ?? "?"}):`,
        contentToSend,
      );
    }

    // Build request payload
    const requestPayload: any = {
      content: contentToSend,
    };
    if (streamId) {
      requestPayload.metadata = {
        stream_id: streamId,
        chunk_id: chunkId ?? null,
      };
    }

    // Call third-party endpoint
    let processed = contentToSend;
    try {
      const fetchOptions: any = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      };

      // Inject Bearer token from config if provided and header not already set
      if (this.config.apiKey && !("Authorization" in fetchOptions.headers)) {
        fetchOptions.headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }

      // In debug mode allow self-signed/invalid certs
      if (this.config.debug) {
        try {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
          const https = await import("https");
          fetchOptions.agent = new https.Agent({ rejectUnauthorized: false });
        } catch {}
      }

      const response = await fetch(ADZEN_ENDPOINT, fetchOptions);

      const rawResp = await response.text();

      // If response is JSON with { content: "..." } use that field
      try {
        const parsedResp = JSON.parse(rawResp);
        if (parsedResp && typeof parsedResp.content === "string") {
          processed = parsedResp.content;
        } else {
          processed = rawResp;
        }
      } catch {
        processed = rawResp;
      }

      if (!response.ok) {
        if (this.config.debug) {
          console.error(`[AdZen] HTTP ${response.status}`, processed);
        }
        // fallback to original on failure
        processed = contentToSend;
      } else if (this.config.debug) {
        console.log("[AdZen] adzen → copilotkit:", processed);
      }
    } catch (err) {
      if (this.config.debug) {
        console.error("[AdZen] fetch error", err);
      }
      processed = contentToSend;
    }

    // Re-inject processed content back into original structure
    if (parsed && contentPath) {
      setNested(parsed, contentPath, processed);
      return JSON.stringify(parsed);
    }

    // Otherwise just return processed string (non-JSON chunk)
    return processed;
  }

  /**
   * Wraps an EventSource (SSE) instance so every "message" event is forwarded.
   * The original EventSource semantics are preserved.
   */
  private wrapEventSource(es: any): any {
    if (!es || typeof es !== "object") return es;

    // Handle custom EventSource with stream() (CopilotKit internal)
    if (typeof es.stream === "function") {
      const originalStream = es.stream.bind(es);
      es.stream = (cb: any) => {
        const wrappedCb = (eventStream: any) => this.wrapEventStream(eventStream).then(cb);
        return originalStream(wrappedCb);
      };
    }

    // If this is a DOM-style EventSource (addEventListener)
    if (typeof es.addEventListener === "function") {
      const originalAdd = es.addEventListener.bind(es);
      es.addEventListener = (type: string, listener: any, options?: any) => {
        if (type === "message") {
          const streamId = randomUUID();
          let counter = 0;
          let chain: Promise<void> = Promise.resolve();
          const wrapped = (ev: MessageEvent) => {
            const chunkId = ++counter;
            chain = chain.then(async () => {
              const processed = await this.forwardChunk(ev.data, streamId, chunkId);
              listener({ ...ev, data: processed });
            });
          };
          return originalAdd(type, wrapped, options);
        }
        return originalAdd(type, listener, options);
      };

      // Patch onmessage shortcut
      let _onmessage = es.onmessage;
      const streamId2 = randomUUID();
      let counter2 = 0;
      let chain2: Promise<void> = Promise.resolve();
      Object.defineProperty(es, "onmessage", {
        get() {
          return _onmessage;
        },
        set: (handler) => {
          _onmessage = handler;
          if (typeof handler === "function") {
            originalAdd("message", (ev: MessageEvent) => {
              const chunkId = ++counter2;
              chain2 = chain2.then(async () => {
                const processed = await this.forwardChunk(ev.data, streamId2, chunkId);
                handler({ ...ev, data: processed } as any);
              });
            });
          }
        },
      });
    }

    return es;
  }

  // Wrap CopilotKit internal event stream object (has sendTextMessageContent etc.)
  private async wrapEventStream(eventStream: any): Promise<any> {
    if (!eventStream || typeof eventStream !== "object") return eventStream;

    const streamId = randomUUID();
    let counter = 0;
    let chain: Promise<void> = Promise.resolve();
    return new Proxy(eventStream, {
      get: (target, prop: string | symbol) => {
        const original = (target as any)[prop];
        if (typeof original === "function" && typeof prop === "string") {
          return (...args: any[]) => {
            let maybeContent = null;
            if (args.length > 0 && typeof args[0] === "object" && args[0] !== null) {
              const first = args[0];
              // Try to get content
              for (const p of CONTENT_PATHS) {
                if (p === "content" && typeof first.content === "string") {
                  maybeContent = first.content;
                  break;
                }
              }
            }

            const execute = async () => {
              if (maybeContent !== null) {
                const chunkId = ++counter;
                const processed = await this.forwardChunk(maybeContent, streamId, chunkId);
                if (typeof args[0] === "object" && args[0] !== null) {
                  (args[0] as any).content = processed;
                }
              }
              return original.apply(target, args);
            };

            chain = chain.then(execute);
            return chain;
          };
        }
        return original;
      },
    });
  }

  /**
   * Create a Proxy that forwards all properties/methods to the upstream
   * adapter but intercepts the return value of "process" so we can wrap its
   * EventSource.
   */
  private createProxy(): any {
    return new Proxy(this, {
      get: (target, prop: string | symbol) => {
        // If AdzenAdapter itself has the property, use it (e.g. cleanup)
        if (prop in target) {
          // @ts-expect-error – dynamic access safe here
          return target[prop];
        }

        // Special-case the typical "process" method used by CopilotKit adapters
        if (prop === "process" && typeof target.upstreamAdapter[prop] === "function") {
          return (...args: any[]) => {
            // If caller passes in eventSource, wrap it upfront so upstream writes through ours
            if (args[0]?.eventSource) {
              args[0].eventSource = target.wrapEventSource(args[0].eventSource);
            }

            const result = target.upstreamAdapter[prop](...args);

            // Also wrap eventSource returned in result (for safety)
            if (result?.eventSource) {
              result.eventSource = target.wrapEventSource(result.eventSource);
            }
            return result;
          };
        }

        // Default behaviour – proxy directly to upstream adapter
        const value = target.upstreamAdapter[prop];
        return typeof value === "function" ? value.bind(target.upstreamAdapter) : value;
      },
    });
  }

  /**
   * Clean up resources if the upstream adapter exposes such a method.
   */
  async cleanup() {
    if (typeof this.upstreamAdapter.cleanup === "function") {
      await this.upstreamAdapter.cleanup();
    }
  }

  static create(upstreamAdapter: any, config: AdzenConfig): any {
    const instance = new AdzenAdapter(upstreamAdapter, config);
    return instance.createProxy();
  }
}

// Utility helpers for dotted / array paths
function getNested(obj: any, path: string): any {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in cur) {
      cur = cur[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

function setNested(obj: any, path: string, value: any): void {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!(k in cur) || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}
