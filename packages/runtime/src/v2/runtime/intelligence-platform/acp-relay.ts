import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";
import { randomUUID } from "crypto";
import { Socket } from "phoenix";

const ACP_RELAY_PROTOCOL = "acp_relay_v1";

interface PushLike {
  receive(status: string, callback: (response?: unknown) => void): PushLike;
}

interface ChannelLike {
  join(): PushLike;
  leave(): unknown;
  on(event: string, callback: (payload: unknown) => void): unknown;
  onError(callback: (reason?: unknown) => void): unknown;
  push(event: string, payload: object): PushLike;
}

interface SocketLike {
  channel(topic: string, params: object): ChannelLike;
  connect(): void;
  disconnect(): void;
  onClose(callback: (event?: { code?: number }) => void): unknown;
  onError(callback: (error?: unknown) => void): unknown;
}

interface SocketOptions {
  readonly params: { readonly joinToken: string; readonly role: "client" };
  readonly reconnectAfterMs: () => number;
  readonly rejoinAfterMs: () => number;
}

/** Parameters for opening one short-lived stable ACP relay connection. */
export interface OpenAcpRelayStreamOptions {
  readonly afterSequence: number;
  readonly joinToken: string;
  readonly sessionId: string;
  readonly socketFactory?: (url: string, options: SocketOptions) => SocketLike;
  readonly wsUrl: string;
}

const reasonText = (value: unknown): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "reason" in value &&
    typeof value.reason === "string"
  ) {
    return value.reason;
  }
  return typeof value === "string" ? value : "ACP relay failed";
};

const isFrame = (value: unknown): value is AnyMessage =>
  typeof value === "object" &&
  value !== null &&
  "jsonrpc" in value &&
  value.jsonrpc === "2.0";

/**
 * Opens a Phoenix channel as a WHATWG stream for the stable ACP SDK.
 * Transport loss closes the stream; callers must start a new AG-UI run.
 */
export function openAcpRelayStream({
  afterSequence,
  joinToken,
  sessionId,
  socketFactory = (url, options) => new Socket(url, options),
  wsUrl,
}: OpenAcpRelayStreamOptions): Promise<Stream> {
  let channel: ChannelLike | undefined;
  let closed = false;
  let joined = false;
  let lastSequence = afterSequence;
  let readableController: ReadableStreamDefaultController<AnyMessage>;
  let replayed = false;
  let rejectOpening: (error: Error) => void;
  let resolveOpening: (stream: Stream) => void;

  const socket = socketFactory(wsUrl, {
    params: { joinToken, role: "client" },
    reconnectAfterMs: () => 60_000,
    rejoinAfterMs: () => 60_000,
  });

  const close = (error?: Error): void => {
    if (closed) return;
    closed = true;
    channel?.leave();
    socket.disconnect();
    if (error) {
      readableController.error(error);
      rejectOpening(error);
    } else {
      readableController.close();
    }
  };

  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      readableController = controller;
    },
    cancel() {
      close();
    },
  });
  const writable = new WritableStream<AnyMessage>({
    write(frame) {
      if (closed || !joined || !replayed || !channel) {
        throw new Error("ACP relay is not open");
      }
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const failWrite = (message: string): void => {
          if (settled) return;
          settled = true;
          const error = new Error(message);
          close(error);
          reject(error);
        };
        channel!
          .push("message", {
            frame,
            protocol: ACP_RELAY_PROTOCOL,
            senderMessageId: randomUUID(),
          })
          .receive("ok", () => {
            if (settled) return;
            settled = true;
            resolve();
          })
          .receive("error", (response) => {
            failWrite(`ACP relay rejected a frame: ${reasonText(response)}`);
          })
          .receive("timeout", () => {
            failWrite("ACP relay frame acknowledgement timed out");
          });
      });
    },
    close() {
      close();
    },
    abort(reason) {
      close(reason instanceof Error ? reason : new Error(reasonText(reason)));
    },
  });
  const stream: Stream = { readable, writable };
  const opening = new Promise<Stream>((resolve, reject) => {
    resolveOpening = resolve;
    rejectOpening = reject;
  });

  const finishOpening = (): void => {
    if (!closed && joined && replayed) {
      resolveOpening(stream);
    }
  };

  socket.onError((error) => {
    close(new Error(`ACP relay error: ${reasonText(error)}`));
  });
  socket.onClose(() => {
    close(new Error("ACP relay disconnected"));
  });
  channel = socket.channel(`session:${sessionId}`, {
    afterSequence,
    protocol: ACP_RELAY_PROTOCOL,
  });
  channel.onError((error) => {
    close(new Error(`ACP relay channel error: ${reasonText(error)}`));
  });
  channel.on("message", (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("protocol" in payload) ||
      payload.protocol !== ACP_RELAY_PROTOCOL ||
      !("sequence" in payload) ||
      typeof payload.sequence !== "number" ||
      !("frame" in payload) ||
      !isFrame(payload.frame)
    ) {
      close(new Error("ACP relay sent an invalid frame"));
      return;
    }
    if (payload.sequence <= lastSequence) return;
    lastSequence = payload.sequence;
    readableController.enqueue(payload.frame);
  });
  channel.on("replay_complete", (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("highWatermark" in payload) ||
      typeof payload.highWatermark !== "number" ||
      payload.highWatermark < lastSequence
    ) {
      close(new Error("ACP relay returned an invalid replay watermark"));
      return;
    }
    lastSequence = payload.highWatermark;
    replayed = true;
    finishOpening();
  });
  channel
    .join()
    .receive("ok", () => {
      joined = true;
      finishOpening();
    })
    .receive("error", (response) => {
      close(new Error(`ACP relay join failed: ${reasonText(response)}`));
    })
    .receive("timeout", () => {
      close(new Error("ACP relay join timed out"));
    });
  socket.connect();

  return opening;
}
