import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * A postMessage transport to a sandbox proxy served from a known origin.
 *
 * ext-apps' `PostMessageTransport` filters incoming messages on `event.source`
 * only and posts with `targetOrigin` `"*"`. With `sandboxOrigin` the host knows
 * which origin the proxy must have, so this transport also drops messages from
 * any other origin and posts only to that one. If the frame is ever navigated
 * elsewhere, the host neither accepts its messages nor sends it any. The
 * frame's window is read on each use rather than once, since it is only
 * guaranteed to be the same object across navigations in browsers.
 */
export class ɵSandboxOriginTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly origin: string,
  ) {}

  private readonly listener = (event: MessageEvent) => {
    if (
      event.source !== this.iframe.contentWindow ||
      event.origin !== this.origin
    ) {
      return;
    }
    const parsed = JSONRPCMessageSchema.safeParse(event.data);
    if (parsed.success) {
      this.onmessage?.(parsed.data);
    } else if (event.data?.jsonrpc === "2.0") {
      this.onerror?.(
        new Error("Invalid JSON-RPC message received: " + parsed.error.message),
      );
    }
  };

  async start(): Promise<void> {
    window.addEventListener("message", this.listener);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.iframe.contentWindow?.postMessage(message, this.origin);
  }

  async close(): Promise<void> {
    window.removeEventListener("message", this.listener);
    this.onclose?.();
  }
}
