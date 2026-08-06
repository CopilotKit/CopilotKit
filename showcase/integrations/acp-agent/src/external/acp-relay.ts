import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import { Socket } from "phoenix";

const ACP_RELAY_PROTOCOL = "acp_relay_v1";

interface PushLike {
  receive(status: string, callback: (payload?: unknown) => void): PushLike;
}

interface ChannelLike {
  join(): PushLike;
  leave(): unknown;
  on(event: string, callback: (payload: unknown) => void): unknown;
  onClose(callback: () => void): unknown;
  onError(callback: (payload?: unknown) => void): unknown;
  push(event: string, payload: object): PushLike;
}

interface SocketLike {
  channel(topic: string, params: object): ChannelLike;
  connect(): void;
  disconnect(): void;
  onClose(callback: () => void): unknown;
  onError(callback: (payload?: unknown) => void): unknown;
}

interface SocketOptions {
  readonly authToken: string;
  readonly params: {
    readonly agentId: string;
    readonly role: "agent";
    readonly runtimeInstanceId: string;
  };
}

interface SessionInvitation {
  readonly lastSequence: number;
  readonly protocol: typeof ACP_RELAY_PROTOCOL;
  readonly remoteSessionId: string | null;
  readonly sessionId: string;
  readonly threadId: string;
}

/** One external ACP session offered by the Showcase carrier fixture. */
export interface ExternalAcpRelaySession {
  readonly remoteSessionId: string | null;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly stream: Stream;
  readonly threadId: string;
}

/** Optional lifecycle returned by a Showcase-owned ACP session handler. */
export interface ExternalAcpSessionHandler {
  readonly closed: Promise<unknown>;
  close(reason?: unknown): unknown;
}

/** Configuration for the Showcase-owned agent-role conformance peer. */
export interface ExternalAcpRelayConfig {
  readonly agentId: string;
  readonly apiKey: string;
  readonly onError?: (error: Error) => void;
  readonly onSession: (
    session: ExternalAcpRelaySession,
  ) => ExternalAcpSessionHandler | void;
  readonly maxWriteAttempts?: number;
  readonly replayTimeoutMs?: number;
  readonly runtimeInstanceId: string;
  readonly socketFactory?: (url: string, options: SocketOptions) => SocketLike;
  readonly wsUrl: string;
}

/** Handle for the long-lived Showcase external relay fixture. */
export interface ExternalAcpRelay {
  readonly closed: Promise<void>;
  readonly ready: Promise<void>;
  close(): void;
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
  return typeof value === "string" ? value : "unknown error";
};

const isFrame = (value: unknown): value is AnyMessage =>
  typeof value === "object" &&
  value !== null &&
  "jsonrpc" in value &&
  value.jsonrpc === "2.0";

const parseInvitation = (value: unknown): SessionInvitation | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("protocol" in value) ||
    value.protocol !== ACP_RELAY_PROTOCOL ||
    !("sessionId" in value) ||
    typeof value.sessionId !== "string" ||
    !("threadId" in value) ||
    typeof value.threadId !== "string" ||
    !("remoteSessionId" in value) ||
    (value.remoteSessionId !== null &&
      typeof value.remoteSessionId !== "string") ||
    !("lastSequence" in value) ||
    typeof value.lastSequence !== "number" ||
    !Number.isSafeInteger(value.lastSequence) ||
    value.lastSequence < 0
  ) {
    return undefined;
  }
  return value as SessionInvitation;
};

/**
 * Connects the Showcase's external ACP fixture to Intelligence.
 *
 * This is conformance code, not a public Runtime API. It owns Phoenix transport
 * only; the caller creates and closes the ACP agent implementation.
 */
export function startExternalAcpRelay({
  agentId,
  apiKey,
  onError = () => undefined,
  onSession,
  maxWriteAttempts = 3,
  replayTimeoutMs = 10_000,
  runtimeInstanceId,
  socketFactory = (url, options) => new Socket(url, options),
  wsUrl,
}: ExternalAcpRelayConfig): ExternalAcpRelay {
  const socket = socketFactory(wsUrl, {
    authToken: apiKey,
    params: { agentId, role: "agent", runtimeInstanceId },
  });
  const active = new Map<string, (error?: Error) => void>();
  let relayClosed = false;
  let readySettled = false;
  let resolveClosed: () => void;
  let rejectClosed: (error: Error) => void;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const report = (error: Error): void => {
    onError(error);
  };

  const closeSessions = (error?: Error): void => {
    for (const close of active.values()) close(error);
  };

  const openSession = (invitation: SessionInvitation): void => {
    if (relayClosed || active.has(invitation.sessionId)) return;

    const abortController = new AbortController();
    let channelJoined = false;
    let handler: ExternalAcpSessionHandler | void;
    let lastSequence = invitation.lastSequence;
    const channel = socket.channel(`session:${invitation.sessionId}`, {
      afterSequence: invitation.lastSequence,
      protocol: ACP_RELAY_PROTOCOL,
    });
    let opened = false;
    let replayed = false;
    let replayTimer: ReturnType<typeof setTimeout> | undefined;
    let sessionClosed = false;
    let readableController: ReadableStreamDefaultController<AnyMessage>;
    const activeWriteFailures = new Set<(error: Error) => void>();
    const close = (error?: Error): void => {
      if (sessionClosed) return;
      sessionClosed = true;
      if (replayTimer) clearTimeout(replayTimer);
      active.delete(invitation.sessionId);
      abortController.abort(error);
      channel.leave();
      handler?.close(error);
      const terminalError = error ?? new Error("ACP Showcase relay closed");
      for (const fail of activeWriteFailures) fail(terminalError);
      activeWriteFailures.clear();
      try {
        if (error) readableController.error(error);
        else readableController.close();
      } catch {
        // The ACP SDK may already have closed the stream while unwinding.
      }
      if (error) report(error);
    };

    const markReplayed = (): void => {
      if (replayTimer) clearTimeout(replayTimer);
      replayTimer = undefined;
    };
    active.set(invitation.sessionId, close);

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
        if (sessionClosed || !opened) {
          throw new Error("ACP Showcase relay session is not open");
        }
        return new Promise<void>((resolve, reject) => {
          const senderMessageId = randomUUID();
          let attempts = 0;
          let settled = false;
          const rejectActiveWrite = (error: Error): void => {
            if (settled) return;
            settled = true;
            activeWriteFailures.delete(rejectActiveWrite);
            reject(error);
          };
          activeWriteFailures.add(rejectActiveWrite);
          const fail = (message: string): void => {
            if (settled) return;
            const error = new Error(message);
            close(error);
            rejectActiveWrite(error);
          };
          const attempt = (): void => {
            if (settled || sessionClosed) return;
            attempts += 1;
            channel
              .push("message", {
                frame,
                protocol: ACP_RELAY_PROTOCOL,
                senderMessageId,
              })
              .receive("ok", () => {
                if (settled) return;
                settled = true;
                activeWriteFailures.delete(rejectActiveWrite);
                resolve();
              })
              .receive("error", (payload) => {
                fail(
                  `ACP Showcase relay rejected a frame: ${reasonText(payload)}`,
                );
              })
              .receive("timeout", () => {
                if (settled) return;
                if (attempts >= maxWriteAttempts) {
                  fail("ACP Showcase relay frame acknowledgement timed out");
                  return;
                }
                setTimeout(() => {
                  attempt();
                }, 0);
              });
          };
          attempt();
        });
      },
      close() {
        close();
      },
      abort(value) {
        close(value instanceof Error ? value : new Error(reasonText(value)));
      },
    });
    const stream: Stream = { readable, writable };

    const finishOpening = (): void => {
      if (opened || sessionClosed || !channelJoined || !replayed) return;
      opened = true;
      try {
        const nextHandler = onSession({
          remoteSessionId: invitation.remoteSessionId,
          sessionId: invitation.sessionId,
          signal: abortController.signal,
          stream,
          threadId: invitation.threadId,
        });
        if (
          nextHandler !== undefined &&
          (typeof nextHandler !== "object" ||
            nextHandler === null ||
            typeof nextHandler.close !== "function" ||
            !(nextHandler.closed instanceof Promise))
        ) {
          throw new Error(
            "ACP Showcase session handlers must return a synchronous lifecycle",
          );
        }
        handler = nextHandler;
        handler?.closed.then(
          () => close(),
          (error: unknown) =>
            close(
              error instanceof Error
                ? error
                : new Error(
                    `ACP Showcase handler failed: ${reasonText(error)}`,
                  ),
            ),
        );
      } catch (error) {
        close(
          error instanceof Error
            ? error
            : new Error(`ACP Showcase handler failed: ${reasonText(error)}`),
        );
      }
    };

    channel.on("message", (payload) => {
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("protocol" in payload) ||
        payload.protocol !== ACP_RELAY_PROTOCOL ||
        !("sequence" in payload) ||
        typeof payload.sequence !== "number" ||
        !Number.isSafeInteger(payload.sequence) ||
        payload.sequence < 1 ||
        !("senderMessageId" in payload) ||
        typeof payload.senderMessageId !== "string" ||
        !("frame" in payload) ||
        !isFrame(payload.frame)
      ) {
        close(
          new Error("ACP Showcase relay received an invalid frame envelope"),
        );
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
        !Number.isSafeInteger(payload.highWatermark) ||
        payload.highWatermark < lastSequence
      ) {
        close(
          new Error("ACP Showcase relay received an invalid replay watermark"),
        );
        return;
      }
      lastSequence = payload.highWatermark;
      replayed = true;
      channelJoined = true;
      markReplayed();
      finishOpening();
    });
    channel.on("peer_disconnected", () =>
      close(new Error("ACP Showcase relay peer disconnected")),
    );
    channel.on("relay_error", (payload) => {
      close(new Error(`ACP Showcase relay failed: ${reasonText(payload)}`));
    });
    channel.onError((payload) => {
      close(
        new Error(`ACP Showcase relay channel failed: ${reasonText(payload)}`),
      );
    });
    channel.onClose(() =>
      close(new Error("ACP Showcase relay channel closed")),
    );
    channel
      .join()
      .receive("ok", () => {
        channelJoined = true;
        if (!replayed) {
          replayTimer = setTimeout(() => {
            close(new Error("ACP Showcase relay replay timed out"));
          }, replayTimeoutMs);
        }
        finishOpening();
      })
      .receive("error", (payload) => {
        close(
          new Error(`ACP Showcase relay join failed: ${reasonText(payload)}`),
        );
      })
      .receive("timeout", () => {
        close(new Error("ACP Showcase relay join timed out"));
      });
  };

  const control = socket.channel("control", { protocol: ACP_RELAY_PROTOCOL });
  const terminateRelay = (error?: Error): void => {
    if (relayClosed) return;
    relayClosed = true;
    if (error && !readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    closeSessions(error);
    control.leave();
    socket.disconnect();
    if (error) report(error);
    if (error) rejectClosed(error);
    else resolveClosed();
  };
  control.on("session_available", (payload) => {
    const invitation = parseInvitation(payload);
    if (!invitation) {
      report(new Error("ACP Showcase received an invalid relay invitation"));
      return;
    }
    openSession(invitation);
  });
  control.onError((payload) => {
    terminateRelay(
      new Error(`ACP Showcase control channel failed: ${reasonText(payload)}`),
    );
  });
  control.onClose(() =>
    terminateRelay(new Error("ACP Showcase control channel closed")),
  );
  socket.onError((payload) => {
    terminateRelay(
      new Error(`ACP Showcase relay socket failed: ${reasonText(payload)}`),
    );
  });
  socket.onClose(() =>
    terminateRelay(new Error("ACP Showcase relay socket closed")),
  );
  control
    .join()
    .receive("ok", () => {
      if (readySettled) return;
      readySettled = true;
      resolveReady();
    })
    .receive("error", (payload) => {
      const error = new Error(
        `ACP Showcase control join failed: ${reasonText(payload)}`,
      );
      terminateRelay(error);
    })
    .receive("timeout", () => {
      const error = new Error("ACP Showcase control join timed out");
      terminateRelay(error);
    });
  socket.connect();

  return {
    closed,
    ready,
    close: () => terminateRelay(),
  };
}
