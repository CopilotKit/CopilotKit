import type { IngressSink } from "@copilotkit/channels-core";
import type { WhatsAppMessageRef, WebhookBody } from "./types.js";
import type { WhatsAppOutbound } from "./render/message.js";
import { WhatsAppClient } from "./client.js";
import type { DownloadedMedia } from "./client.js";
import { WebhookServer } from "./webhook-server.js";
import { handleWebhookValue } from "./webhook-listener.js";
import type { HistoryStore } from "./history-store.js";
import type { FileDeliveryConfig } from "./download-files.js";

/**
 * Everything the adapter hands the connector to start OWNING the live
 * WhatsApp webhook connection (Channel Runner plan §2, mirroring
 * `SlackIngressConfig`): only serializable, non-credential config + the sink
 * cross this port. `history` stays adapter-supplied (a `HistoryStore` never
 * carries a token) so its persistence choice stays entirely adapter-side even
 * though the connector is what invokes it per inbound webhook value.
 */
export interface WhatsAppIngressConfig {
  /** Where every normalized turn/command/interaction lands. */
  sink: IngressSink;
  /** Pluggable conversation-history persistence (adapter-owned; no token). */
  history: HistoryStore;
  /** Prefix for leading-keyword command matching. */
  commandPrefix: string;
  /** Inbound media handling config. */
  files: FileDeliveryConfig;
}

/**
 * Every credentialed WhatsApp Cloud API operation `WhatsAppAdapter` performs,
 * behind a port whose method signatures carry only serializable data (a
 * recipient wa_id, a rendered `WhatsAppOutbound` payload, media bytes/ids) —
 * never an access token. That's the whole point: the managed Connector Outbox
 * implements this SAME interface with its own credentialed sender, and a
 * custom runner can supply another. The adapter holds NO credentials of its
 * own — every method here is reached only through a connector a runner
 * INJECTS via `WhatsAppAdapter.ɵbindConnector` (see adapter.ts); calling any
 * adapter egress method or `start()` before that throws.
 */
export interface WhatsAppConnector {
  /** POST a message; returns the outbound message ref (`wamid.*`). */
  sendMessage(
    to: string,
    payload: WhatsAppOutbound,
  ): Promise<WhatsAppMessageRef>;
  /** Upload media (multipart) and return its media id. Backs `postFile`. */
  uploadMedia(
    bytes: Uint8Array,
    mimeType: string,
    filename?: string,
  ): Promise<string>;
  /** Resolve + download an inbound media id. Backs inbound file handling. */
  downloadMedia(mediaId: string): Promise<DownloadedMedia>;
  /** Mark an inbound message read and optionally show a typing indicator. */
  sendReadReceipt(
    messageId: string,
    opts?: { typing?: boolean },
  ): Promise<void>;

  /**
   * Start OWNING the live WhatsApp webhook connection (Task 3b, plan §2 D3):
   * bind the inbound HTTP server (GET verify handshake + signed POST intake)
   * and normalize each webhook value via the adapter's pure
   * `handleWebhookValue`, forwarding to `config.sink`. Resolves once the
   * server is listening.
   */
  startIngress(config: WhatsAppIngressConfig): Promise<void>;
  /** Stop the live connection started by {@link startIngress}. */
  stopIngress(): Promise<void>;
}

/** Constructor config for {@link WebClientWhatsAppConnector} — everything credential-shaped now lives HERE, not on the adapter. */
export interface WebClientWhatsAppConnectorOptions {
  /** Cloud API access token (Bearer). */
  accessToken: string;
  /** Business phone-number id that sends messages. */
  phoneNumberId: string;
  /** App secret used to validate X-Hub-Signature-256 on inbound POSTs. */
  appSecret: string;
  /** Token echoed during the GET verification handshake (hub.verify_token). */
  verifyToken: string;
  /** HTTP server port (default 3000). */
  port?: number;
  /** Webhook path (default "/webhook"). */
  path?: string;
  /** Graph API version (default "v21.0"). */
  apiVersion?: string;
  /** Graph API base origin (default "https://graph.facebook.com"). Overridable for tests. */
  graphBaseUrl?: string;
}

/**
 * The default {@link WhatsAppConnector}: CREDENTIAL-OWNING — constructed with
 * `accessToken`/`phoneNumberId`/etc. and building BOTH its own
 * `WhatsAppClient` (egress + media) and its own `WebhookServer` (ingress, on
 * {@link startIngress}) internally. Nothing token-shaped ever crosses back out
 * to the adapter. A runner (custom `ChannelRunner`, or the managed Connector
 * Outbox's own implementation of this interface) constructs one of these —
 * or an equivalent — and injects it via `WhatsAppAdapter.ɵbindConnector`.
 */
export class WebClientWhatsAppConnector implements WhatsAppConnector {
  private readonly client: WhatsAppClient;
  private readonly server: WebhookServer;
  private readonly phoneNumberId: string;
  private readonly port: number;
  /** Set by {@link startIngress}; undefined until then. */
  private ingressConfig: WhatsAppIngressConfig | undefined;

  constructor(opts: WebClientWhatsAppConnectorOptions) {
    this.phoneNumberId = opts.phoneNumberId;
    this.port = opts.port ?? 3000;
    this.client = new WhatsAppClient({
      accessToken: opts.accessToken,
      phoneNumberId: opts.phoneNumberId,
      apiVersion: opts.apiVersion,
      graphBaseUrl: opts.graphBaseUrl,
    });
    this.server = new WebhookServer({
      path: opts.path ?? "/webhook",
      verifyToken: opts.verifyToken,
      appSecret: opts.appSecret,
      onEvent: (body) => this.onWebhook(body),
    });
  }

  async sendMessage(
    to: string,
    payload: WhatsAppOutbound,
  ): Promise<WhatsAppMessageRef> {
    return this.client.sendMessage(to, payload);
  }

  async uploadMedia(
    bytes: Uint8Array,
    mimeType: string,
    filename?: string,
  ): Promise<string> {
    return this.client.uploadMedia(bytes, mimeType, filename);
  }

  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    return this.client.downloadMedia(mediaId);
  }

  async sendReadReceipt(
    messageId: string,
    opts: { typing?: boolean } = {},
  ): Promise<void> {
    return this.client.sendReadReceipt(messageId, opts);
  }

  private async onWebhook(body: WebhookBody): Promise<void> {
    const config = this.ingressConfig;
    if (!config) return;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (!change.value) continue;
        await handleWebhookValue(change.value, {
          sink: config.sink,
          history: config.history,
          phoneNumberId: this.phoneNumberId,
          commandPrefix: config.commandPrefix,
          client: this.client,
          files: config.files,
        });
      }
    }
  }

  async startIngress(config: WhatsAppIngressConfig): Promise<void> {
    this.ingressConfig = config;
    await this.server.start(this.port);
  }

  async stopIngress(): Promise<void> {
    await this.server.stop();
  }
}
