import type { IngressSink, IncomingTurn } from "@copilotkit/channels-core";
import type {
  WhatsAppConnector,
  WhatsAppIngressConfig,
} from "../whatsapp-connector.js";
import type { WhatsAppMessageRef } from "../types.js";
import type { WhatsAppOutbound } from "../render/message.js";
import type { DownloadedMedia } from "../client.js";

/** One recorded call to a {@link FakeWhatsAppConnector} op, in call order. */
export type WhatsAppConnectorCall =
  | { op: "sendMessage"; args: { to: string; payload: WhatsAppOutbound } }
  | {
      op: "uploadMedia";
      args: { bytes: Uint8Array; mimeType: string; filename?: string };
    }
  | { op: "downloadMedia"; args: { mediaId: string } }
  | {
      op: "sendReadReceipt";
      args: { messageId: string; opts?: { typing?: boolean } };
    };

/**
 * Per-op canned responses / failures a test can set on a
 * {@link FakeWhatsAppConnector} before exercising it. Anything left unset
 * falls back to a harmless default (an incrementing fake `wamid`, empty
 * media, etc.).
 */
export interface FakeWhatsAppConnectorResults {
  uploadMedia?: string;
  downloadMedia?: DownloadedMedia;
  /** Ops (by name) that should reject instead of resolving, with the given error. */
  throwing?: Partial<Record<WhatsAppConnectorCall["op"], Error>>;
}

/**
 * Records every call made to it (op + exact args, in order) and resolves with
 * configurable canned responses — the TDD fixture proving `WhatsAppAdapter`'s
 * egress methods route to the right {@link WhatsAppConnector} op with the
 * right args, without a real (or fetch-shaped fake) Cloud API underneath.
 */
export class FakeWhatsAppConnector implements WhatsAppConnector {
  readonly calls: WhatsAppConnectorCall[] = [];
  private seq = 0;
  /** Set by {@link startIngress}; readable so a test can assert on the config it was handed. */
  ingressConfig: WhatsAppIngressConfig | undefined;
  /** True once {@link stopIngress} has been called. */
  ingressStopped = false;
  /**
   * Captured from {@link WhatsAppIngressConfig.sink} by {@link startIngress}
   * — the SAME `IngressSink` a real webhook-backed connector would forward
   * normalized turns to. Lets {@link emitTurn} push a fake inbound turn
   * straight into the real channels-core dispatch (`sink.onTurn` → §2
   * `decideChannelResponse` → `thread.runAgent` → egress) without a real
   * HTTP webhook — the Model-1 standalone proof.
   */
  private sink: IngressSink | undefined;

  constructor(readonly results: FakeWhatsAppConnectorResults = {}) {}

  private throwIfConfigured(op: WhatsAppConnectorCall["op"]): void {
    const err = this.results.throwing?.[op];
    if (err) throw err;
  }

  async sendMessage(
    to: string,
    payload: WhatsAppOutbound,
  ): Promise<WhatsAppMessageRef> {
    this.calls.push({ op: "sendMessage", args: { to, payload } });
    this.throwIfConfigured("sendMessage");
    return { id: `fake-wamid-${++this.seq}`, to, phoneNumberId: "FAKE_PNID" };
  }

  async uploadMedia(
    bytes: Uint8Array,
    mimeType: string,
    filename?: string,
  ): Promise<string> {
    this.calls.push({ op: "uploadMedia", args: { bytes, mimeType, filename } });
    this.throwIfConfigured("uploadMedia");
    return this.results.uploadMedia ?? `fake-media-${++this.seq}`;
  }

  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    this.calls.push({ op: "downloadMedia", args: { mediaId } });
    this.throwIfConfigured("downloadMedia");
    return (
      this.results.downloadMedia ?? {
        bytes: new Uint8Array(),
        mimeType: "application/octet-stream",
      }
    );
  }

  async sendReadReceipt(
    messageId: string,
    opts?: { typing?: boolean },
  ): Promise<void> {
    this.calls.push({ op: "sendReadReceipt", args: { messageId, opts } });
    this.throwIfConfigured("sendReadReceipt");
  }

  /**
   * No real webhook HTTP server here — records the config it was handed (so
   * a test can assert on `commandPrefix`/`files`) and captures `config.sink`
   * (see {@link emitTurn}) so a test can drive fake inbound turns through it.
   * Raw Cloud-API-shaped ingress (webhook POST bodies) is still exercised
   * against `webhook-listener.test.ts` directly — this fake only proves what
   * happens AFTER a turn reaches the sink.
   */
  async startIngress(config: WhatsAppIngressConfig): Promise<void> {
    this.ingressConfig = config;
    this.sink = config.sink;
  }

  async stopIngress(): Promise<void> {
    this.ingressStopped = true;
  }

  /**
   * Push a fake inbound turn through the `sink` captured by
   * {@link startIngress} — the Model-1 standalone proof's ingress entry
   * point. Mirrors `FakeSlackConnector.emitTurn`, but RETURNS the underlying
   * `sink.onTurn` promise (rather than firing-and-forgetting) so a test can
   * `await` a turn all the way through §2's `decideChannelResponse` →
   * `thread.runAgent` → egress before asserting.
   *
   * Throws if ingress hasn't started yet (`channel.start()`/
   * `WhatsAppAdapter.start()` not called) — this proves the standalone
   * dispatch wiring, so a call before `start()` is a test bug, not a
   * tolerable no-op.
   */
  emitTurn(
    turn: Partial<IncomingTurn> & { conversationKey: string },
  ): Promise<void> {
    if (!this.sink) {
      throw new Error(
        "FakeWhatsAppConnector.emitTurn: ingress not started — call " +
          "channel.start() (which calls WhatsAppAdapter.start()) first",
      );
    }
    return Promise.resolve(
      this.sink.onTurn({
        replyTarget: { to: "111", phoneNumberId: "FAKE_PNID" },
        userText: "",
        platform: "whatsapp",
        conversationKind: "direct_message",
        mentioned: false,
        ...turn,
      }),
    );
  }
}
