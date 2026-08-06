import { Socket } from "phoenix";
import type { Channel } from "phoenix";
import type { CHANNEL_DELIVERY_PROTOCOL } from "./delivery-contracts.js";

/**
 * Minimal Realtime Gateway session surface used by the delivery/render
 * transport. The connector adapts its private socket implementation to this
 * contract so callers never depend on a protocol client.
 */
export interface RealtimeGatewaySession {
  push(event: string, payload: unknown): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): void;
  /** Join one delivery-scoped Phoenix topic on the existing socket. */
  join?(
    topic: string,
    payload: unknown,
  ): Promise<RealtimeGatewayDeliveryChannel>;
}

/**
 * Managed provider attachment state the Gateway reports for one declared
 * Channel on the control join reply.
 *
 * Mirrors `RealtimeGateway.Channels.ChannelProviderStateStore`, which is
 * authoritative. Keep these descriptions in step with it — the whole reason this
 * seam exists is that a state's description outlived its mechanism once already.
 *
 * - `attached`: a declared adapter is `active` AND finished setup, and its last
 *   health check did not fail — the Channel can actually receive provider
 *   traffic. The adapter's own `status` is part of the predicate, not just its
 *   setup state: Slack ingress only resolves an inbound event through an
 *   `active` adapter, so reporting `attached` for a `draft`, `disabled`, or
 *   `error` adapter would reintroduce the false green one state further along.
 * - `unhealthy`: a declared adapter is bound but broken — either `active` and
 *   set up with a failed health check, or set up with the adapter row itself in
 *   `error` (which is `unhealthy` even with no failed health check recorded).
 * - `not_attached`: the Channel exists on the project but no declared adapter
 *   has a row, none has finished setup, or none is `active` — the normal state
 *   while setup is still in progress.
 * - `disabled`: the Channel row itself is disabled on the project.
 * - `channel_not_declared`: the project has no Channel with that name.
 *
 * A Runtime declares EVERY supported adapter per Channel (the launcher emits a
 * `slack` and a `teams` pair unconditionally), so the Gateway folds the adapter
 * states BEST-of — `attached` > `unhealthy` > `not_attached` — answering "is at
 * least one provider bound?". A correctly configured Slack-only Channel is
 * therefore `attached`, not dragged to `not_attached` by the Teams adapter
 * nobody asked for. The two Channel-level states above are properties of the
 * Channel row and dominate every adapter state.
 */
export type ChannelProviderState =
  | "attached"
  | "unhealthy"
  | "not_attached"
  | "disabled"
  | "channel_not_declared";

/** Provider attachment state keyed by declared Channel name. */
export type ChannelProviderStates = Readonly<
  Record<string, ChannelProviderState>
>;

/**
 * Every state {@link parseChannelProviderStates} will accept.
 *
 * The runtime's `channel-manager.ts` duplicates this set as `PROVIDER_LEGS`,
 * because that package must not take a static dependency on this one (it reaches
 * this module only through a dynamic import), so the `providerStates` seam
 * between them is deliberately duck-typed as `Record<string, string>`.
 *
 * Adding a state here therefore needs the same addition THERE, plus a `case` in
 * that file's `foldChannelLegs`. Until both land, the new state fails open to
 * `unknown` on the consuming side — the Channel keeps its transport-derived
 * status rather than being wrongly certified or condemned. Safe, but silent.
 */
const PROVIDER_STATES: ReadonlySet<string> = new Set<ChannelProviderState>([
  "attached",
  "unhealthy",
  "not_attached",
  "disabled",
  "channel_not_declared",
]);

/**
 * Read the `channels` map off a control join reply.
 *
 * Returns `undefined` — meaning "the Gateway did not tell us" — when the key is
 * absent, malformed, or carries an unrecognised state. A Gateway older than the
 * provider-state contract and a Gateway whose database read failed both omit the
 * key, and both must degrade to transport-only status rather than be mistaken
 * for "no provider attached". Unknown values are dropped individually so one bad
 * entry cannot hide the states that did parse.
 *
 * @param reply - Raw control-topic join reply.
 * @returns Parsed provider states, or `undefined` when none were reported.
 */
export function parseChannelProviderStates(
  reply: unknown,
): ChannelProviderStates | undefined {
  if (typeof reply !== "object" || reply === null) return undefined;
  const raw = (reply as { channels?: unknown }).channels;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const states: Record<string, ChannelProviderState> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" && PROVIDER_STATES.has(value)) {
      states[name] = value as ChannelProviderState;
    }
  }
  return Object.keys(states).length > 0 ? states : undefined;
}

/** One joined delivery topic. */
export interface RealtimeGatewayDeliveryChannel extends RealtimeGatewaySession {
  /** Prepared delivery returned by the token-consuming join. */
  readonly joinReply: unknown;
  /** Observe a delivery-topic drop before requesting a fresh one-use token. */
  onClose(handler: () => void): void;
  leave(): void;
}

/** @internal Options for {@link connectRealtimeGateway}. */
export interface ConnectRealtimeGatewayOptions {
  /**
   * Fully-resolved gateway Channels socket URL, e.g.
   * `wss://gateway.example/channels`. This is not the public `wsUrl` a developer
   * configures — the Intelligence client appends `/channels` before it reaches
   * here, and Phoenix appends
   * `/websocket` to this value on connect. `/socket` is not a mounted path.
   */
  wsUrl: string;
  /** Runtime API key (`cpk-…`) authenticating the socket. */
  apiKey: string;
  /** Numeric project id bound by API-key authentication. */
  projectId: number;
  /** Listener declaration sent as the channel join payload. */
  join: {
    /** Exact protocol required by the Gateway control topic. */
    protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
    runtimeInstanceId: string;
    channels: ReadonlyArray<{
      channelName: string;
      adapter: string;
    }>;
  };
  /** Per-push / join timeout in ms (default 10000). */
  timeoutMs?: number;
  /** WebSocket constructor; defaults to the global (Node 22+/browser). */
  webSocket?: unknown;
  /**
   * Max time (ms) the session may stay `reconnecting` after an unexpected drop
   * before it declares the connection dead and emits `gave_up` (default 60000).
   *
   * Phoenix's `Socket` retries a dropped connection FOREVER by default, so
   * `status()` on a supervising manager would otherwise report `reconnecting`
   * indefinitely for a gateway that never comes back (host down, credentials
   * revoked). This bounds that: if a successful (re)join does not restore the
   * session within this window, the session gives up and the manager can map it
   * to `error`. The window runs from the FIRST drop of an outage episode and is
   * cleared on the next successful (re)join.
   */
  reconnectGiveUpMs?: number;
  /**
   * Max time (ms) the INITIAL connect may spend without the socket ever opening
   * before the connect is declared unreachable (default 30000) — the mirror of
   * {@link reconnectGiveUpMs} for a socket that has never connected once.
   *
   * Phoenix retries a failed connect forever and surfaces transport errors as
   * reconnect churn, so a wrong/unreachable `wsUrl` (DNS miss, refused TCP
   * connect, a host serving HTTP with no socket mounted) would otherwise hang
   * until a supervising manager's settle deadline and report only a timeout,
   * with no indication that the HOST is the problem (OSS-623). When this window
   * elapses with the socket still never opened, the connect rejects with a
   * {@link RealtimeGatewayUnreachableError} naming the endpoint and the cause.
   *
   * The window exists rather than failing on the first transport error because
   * a refused connect is often just a gateway that has not finished booting,
   * and a supervising `ChannelManager` retries classified transient failures.
   * The window avoids opening a new socket for every failed attempt during a
   * short boot race. Causes that CANNOT resolve themselves (a host that does
   * not exist) skip the window entirely; see {@link diagnoseEndpoint}.
   */
  connectTimeoutMs?: number;
  /**
   * @internal Test seam for the unreachable-host diagnosis (see
   * {@link diagnoseEndpoint}); defaults to the global `fetch`. Production always
   * uses the default — this exists so the diagnosis's REAL classification logic
   * runs in tests against recorded transport failures instead of the network.
   */
  diagnosticFetch?: typeof globalThis.fetch;
}

/**
 * Connection-health states a {@link ConnectedRealtimeGatewaySession} surfaces to
 * a supervising manager via {@link ConnectedRealtimeGatewaySession.onStateChange}.
 *
 * - `online`: the managed path can currently send (joined/rejoined).
 * - `reconnecting`: the connection dropped and Phoenix is retrying; not sendable.
 * - `gave_up`: the reconnect window elapsed without a successful rejoin — treated
 *   as "currently not sendable, prolonged" (a supervising manager maps it to
 *   `error`). STICKY: while Phoenix keeps retrying the dead link underneath,
 *   failed retries do NOT flap back to `reconnecting` — the state stays `gave_up`
 *   until a rejoin actually succeeds. NOT terminal, though: a later SUCCESSFUL
 *   rejoin transitions back to `online` (self-healing a transient outage without
 *   a process restart) and re-arms the window so a genuinely fresh drop episode
 *   can transition back to `reconnecting`.
 */
export type RealtimeGatewayConnectionState =
  | "online"
  | "reconnecting"
  | "gave_up";

/**
 * Why a connection-health transition happened. Present on `reconnecting` and
 * `gave_up` when the transport (or the endpoint probe in
 * {@link connectRealtimeGateway}) reported something; absent on `online` and
 * whenever nothing was reported. Contains no secrets — the auth token travels as
 * a WebSocket subprotocol, never in a URL or an error message.
 */
export interface RealtimeGatewayConnectionDetail {
  /** Rendered cause, phrased for whoever operates the runtime. */
  reason?: string;
  /** OS-level code behind the failure, when the transport exposed one. */
  code?: string;
}

/**
 * Signals that the gateway socket NEVER opened — the configured `wsUrl` host is
 * wrong or unreachable (DNS miss, refused/failed TCP or TLS connect, or a host
 * that serves HTTP with no Phoenix socket mounted at the endpoint). Carries the
 * endpoint that was tried and the underlying transport error so the message
 * points at the misconfigured URL rather than at a stopwatch (OSS-623).
 *
 * Permanent reachability failures such as NXDOMAIN reject `ready()`. Transient
 * failures such as an HTTP 5xx response carry `retryable=true`, allowing the
 * runtime manager to attempt a fresh initial connection with backoff.
 */
export class RealtimeGatewayUnreachableError extends Error {
  /** Cross-package marker, mirroring the `code` convention of its siblings. */
  readonly code = "GATEWAY_UNREACHABLE";
  /** Whether reconnecting later can succeed without changing configuration. */
  readonly retryable: boolean;
  /** The gateway endpoint that was tried, minus any query string. */
  readonly endpoint: string;
  /**
   * The underlying transport failure (e.g. `getaddrinfo ENOTFOUND host`), or
   * `undefined` when the connect hung without reporting one at all. Contains no
   * secrets — the auth token travels as a WebSocket subprotocol, not in the URL.
   */
  readonly transportError: string | undefined;
  /**
   * @param endpoint - The gateway endpoint that was tried (no query string).
   * @param transportError - Rendered transport failure, if one was reported.
   * @param connectTimeoutMs - The elapsed connect window, named when no
   *   transport error was reported (the only signal the caller has left).
   * @param options - Retry classification plus the raw transport error.
   */
  constructor(
    endpoint: string,
    transportError: string | undefined,
    connectTimeoutMs: number,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(
      `realtime gateway unreachable: the socket never connected to ${endpoint} ` +
        (transportError !== undefined
          ? `(${transportError})`
          : `and reported no transport error within ${connectTimeoutMs}ms`) +
        " — check that the Intelligence wsUrl points at the gateway host",
      options,
    );
    this.name = "RealtimeGatewayUnreachableError";
    this.endpoint = endpoint;
    this.transportError = transportError;
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * Signals that the gateway accepted the socket but rejected its initial
 * logical join. Structured retry hints survive this boundary so a supervising
 * runtime can distinguish a draining gateway from a permanent rejection.
 */
export class RealtimeGatewayJoinError extends Error {
  /** Cross-package marker used by the runtime activation retry policy. */
  readonly code = "GATEWAY_JOIN_FAILED";
  /** Gateway response returned with the failed join. */
  readonly reason: unknown;
  /** Whether a fresh activation can succeed without a configuration change. */
  readonly retryable: boolean;

  /**
   * @param reason - Structured gateway join rejection.
   * @param options - Optional retry override and timeout-specific message.
   */
  constructor(
    reason: unknown,
    options?: { message?: string; retryable?: boolean },
  ) {
    super(
      options?.message ??
        `realtime gateway session join failed: ${safeReason(reason)}`,
      { cause: reason },
    );
    this.name = "RealtimeGatewayJoinError";
    this.reason = reason;
    this.retryable = options?.retryable ?? isRetryableJoinRejection(reason);
  }
}

/** Whether a structured gateway join rejection asks the client to retry. */
function isRetryableJoinRejection(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null) {
    return false;
  }
  const response = reason as { reason?: unknown; retryable?: unknown };
  if (response.retryable === false) {
    return false;
  }
  return response.retryable === true || response.reason === "gateway_draining";
}

/** Typed rejection returned by a joined realtime gateway channel push. */
export class RealtimeGatewayPushError extends Error {
  constructor(
    readonly event: string,
    readonly code: string | undefined,
    reason: unknown,
  ) {
    super(
      `realtime gateway session push ${event} failed: ${safeReason(reason)}`,
    );
    this.name = "RealtimeGatewayPushError";
  }
}

/**
 * Error codes that mean the configured host CANNOT come up on its own, so the
 * initial connect fails immediately instead of waiting out
 * {@link ConnectRealtimeGatewayOptions.connectTimeoutMs}.
 *
 * Deliberately limited to name-resolution failures that mean NXDOMAIN — the
 * host does not exist, which is always a typo/misconfiguration (this is exactly
 * the OSS-621 case: a `wsUrl` documented everywhere with no DNS record at all).
 * Codes that CAN clear on their own are excluded on purpose and left to the
 * connect window: `ECONNREFUSED` (gateway still booting), `EAI_AGAIN` (a
 * transient resolver failure/timeout, NOT NXDOMAIN), `ETIMEDOUT`, `ECONNRESET`.
 */
const NON_RETRYABLE_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_NONAME",
]);

/**
 * Phrase a post-connect probe result for whoever operates the runtime.
 *
 * The probe is deliberately UNAUTHENTICATED (see {@link diagnoseEndpoint}), so a
 * `401`/`403` from it says nothing about whether OUR key is still valid — an
 * unauthenticated GET is refused either way. What the probe does establish is
 * reachability: the host answered, so a socket that still will not open is
 * failing at the handshake rather than in the network. Say exactly that, and
 * separate "answered but unhealthy" (5xx — typically a gateway restart) from
 * "answered fine, handshake refused", where a credential is worth checking.
 */
function describeRefusedUpgrade(result: EndpointDiagnosis): string | undefined {
  if (result.status === undefined) return result.text;
  if (result.status >= 500) {
    return (
      `the gateway host answered HTTP ${result.status}, so it is reachable but not healthy — ` +
      "it may be restarting"
    );
  }
  return (
    `the gateway host answered HTTP ${result.status} but the WebSocket handshake was refused, ` +
    "so this is not a network outage — verify the project API key"
  );
}

/** What {@link diagnoseEndpoint} learned about an endpoint that would not connect. */
interface EndpointDiagnosis {
  /** Human-readable cause, phrased for the person who set `wsUrl`. */
  readonly text: string;
  /** OS-level code behind the failure, when one was exposed. */
  readonly code?: string;
  /** Whether the cause cannot clear on its own (fail now, don't wait). */
  readonly nonRetryable: boolean;
  /** HTTP status the host answered with, when it answered at all. */
  readonly status?: number;
  /** The raw failure, attached to the thrown error as `cause`. */
  readonly cause?: unknown;
}

/**
 * Probe the endpoint over HTTP to find out WHY the socket would not open.
 *
 * This exists because the WebSocket transport itself will not say. Node's global
 * WebSocket (undici) dispatches the same information-free `ErrorEvent` —
 * `"Received network error or non-101 status code."`, no `code`, an inner
 * `Error` with no detail — whether the host does not resolve, refuses the
 * connection, or answers HTTP with no socket mounted at the path. Browsers are
 * deliberately worse. Only a non-WebSocket request to the same origin exposes
 * the real cause, and `fetch` does: a nonexistent host surfaces
 * `cause.code === "ENOTFOUND"`, a closed port `"ECONNREFUSED"`, and a host that
 * is up answers with an HTTP status.
 *
 * Runs ONLY on the failure path (a socket that has never opened), so a healthy
 * connect issues no extra request. Never throws and never rejects: a diagnosis
 * is a nicety on top of the error being reported either way, so any failure to
 * obtain one yields `undefined`.
 *
 * @param wsUrl - The configured gateway URL, mapped to its http(s) equivalent.
 * @param timeoutMs - Probe budget; kept well under the connect window.
 * @param fetchImpl - Injected `fetch` (test seam); defaults to the global.
 * @returns The diagnosis, or `undefined` when none could be obtained.
 */
async function diagnoseEndpoint(
  wsUrl: string,
  timeoutMs: number,
  fetchImpl: typeof globalThis.fetch | undefined = globalThis.fetch,
): Promise<EndpointDiagnosis | undefined> {
  const httpUrl = toHttpProbeUrl(wsUrl);
  if (httpUrl === undefined || typeof fetchImpl !== "function") {
    return undefined;
  }
  // `AbortSignal.timeout` is Node 17.3+/modern-browser; tolerate its absence
  // rather than lose the whole diagnosis on an older host.
  const signal =
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  try {
    // No auth header: this is a reachability probe, and the token belongs on the
    // socket handshake only. `redirect: "manual"` keeps a redirect visible as a
    // status rather than following the caller's URL somewhere else.
    const response = await fetchImpl(httpUrl, {
      method: "GET",
      redirect: "manual",
      ...(signal ? { signal } : {}),
    });
    return {
      text:
        `the host answered HTTP ${response.status} for ${httpUrl}, so it resolves and accepts ` +
        "connections — only the WebSocket handshake failed, so the wsUrl path may not be the " +
        "gateway's socket endpoint",
      nonRetryable: false,
      status: response.status,
    };
  } catch (err) {
    const { text, code } = describeTransportError(err);
    if (code !== undefined && NON_RETRYABLE_TRANSPORT_CODES.has(code)) {
      return {
        text: `the host does not resolve (${text ?? code})`,
        code,
        nonRetryable: true,
        cause: err,
      };
    }
    if (code === "ECONNREFUSED") {
      return {
        text: `the host refused the connection (${text ?? code})`,
        code,
        nonRetryable: false,
        cause: err,
      };
    }
    return text !== undefined
      ? {
          text,
          ...(code !== undefined ? { code } : {}),
          nonRetryable: false,
          cause: err,
        }
      : undefined;
  }
}

/**
 * Map a gateway `ws(s)://` URL to the `http(s)://` URL {@link diagnoseEndpoint}
 * probes — same host, port, and PATH (the path is what distinguishes "no socket
 * mounted here" from a wrong host), minus query and fragment. Returns
 * `undefined` for a URL that cannot be parsed or is not a ws/http scheme.
 */
function toHttpProbeUrl(wsUrl: string): string | undefined {
  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

/** A connected {@link RealtimeGatewaySession} plus a shutdown operation. */
export interface ConnectedRealtimeGatewaySession extends RealtimeGatewaySession {
  disconnect(): void;
  /**
   * Register a callback to fire when the underlying Phoenix connection drops
   * unexpectedly (a real network/server-side disconnect), NOT when it drops as
   * a result of our own {@link disconnect}. Phoenix surfaces a drop through
   * both the socket's `onClose`/`onError` and the channel's `onClose`/`onError`
   * for the very same event, so the callback fires exactly once per drop
   * episode. Because Phoenix's `Socket` auto-reconnects and this session
   * persists across reconnects, the dedupe latch resets on a successful
   * reopen — so a later, distinct drop notifies again rather than being
   * silently absorbed by the first drop's latch.
   */
  onClose(cb: () => void): void;
  /**
   * Register a connection-health observer. The callback fires on each
   * transition between {@link RealtimeGatewayConnectionState} values (never with
   * the same state twice in a row):
   *
   * - an unexpected socket-level OR channel-level drop → `reconnecting` (Phoenix
   *   begins retrying). Phoenix can error/rejoin a Channel while the socket stays
   *   open (pushes still can't send), so both are routed through the same health
   *   transition, deduped so one drop episode = one `reconnecting` transition;
   * - a successful (re)join → `online` (the recHooks registered on the join push
   *   survive Phoenix's `resend`, so every auto-rejoin re-fires the `"ok"` hook);
   * - the {@link ConnectRealtimeGatewayOptions.reconnectGiveUpMs} window elapsing
   *   while still reconnecting → `gave_up`. STICKY: failed retries during the same
   *   outage do NOT re-emit `reconnecting`. NOT terminal — a later SUCCESSFUL
   *   rejoin transitions back to `online` (a transient outage self-heals) and
   *   re-arms the window so a fresh drop episode can transition to `reconnecting`.
   *
   * Our own {@link disconnect} is silent (it is not a drop). Distinct from
   * {@link onClose}, which is a single per-episode drop breadcrumb; this observer
   * tracks the full health lifecycle so a manager's `status()` can reflect it.
   */
  onStateChange(
    cb: (
      state: RealtimeGatewayConnectionState,
      detail?: RealtimeGatewayConnectionDetail,
    ) => void,
  ): void;
  /**
   * Managed provider attachment state per declared Channel, as reported on the
   * newest control join reply — or `undefined` when the Gateway did not report
   * it.
   *
   * A GETTER rather than a snapshot so callers always read the current value:
   * the join hooks re-fire on every Phoenix auto-rejoin, so a Channel
   * provisioned while the runtime was disconnected reports `attached` after the
   * next rejoin with no extra plumbing.
   *
   * `undefined` means "not reported", NOT "no provider attached". A Gateway
   * predating this contract and one whose database read failed both omit the
   * key, and a caller must degrade to transport-only status in both cases rather
   * than claim a Channel is unprovisioned.
   */
  providerStates(): ChannelProviderStates | undefined;
}

/**
 * @internal Connect the SDK to a Realtime Gateway session. Socket/client
 * values stay private here; callers receive only {@link RealtimeGatewaySession}.
 *
 * The session is joined (declaring the runtime's channels) before the promise
 * resolves, so the caller can receive delivery invitations and send ordered
 * provider effects.
 *
 * @param config - Gateway URL, auth, project scope, and join declaration.
 * @returns The connected channel with a `disconnect()` teardown.
 */
export async function connectRealtimeGateway(
  config: ConnectRealtimeGatewayOptions,
): Promise<ConnectedRealtimeGatewaySession> {
  if (!Number.isSafeInteger(config.projectId) || config.projectId <= 0) {
    throw new Error(
      "connectRealtimeGateway: projectId must be a positive integer",
    );
  }
  const timeout = config.timeoutMs ?? 10_000;
  const giveUpMs = config.reconnectGiveUpMs ?? 60_000;
  const connectTimeoutMs = config.connectTimeoutMs ?? 30_000;
  const transport =
    config.webSocket ??
    (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  if (!transport) {
    throw new Error(
      "connectRealtimeGateway: no WebSocket available — pass config.webSocket or run on Node 22+",
    );
  }

  const socket = new Socket(config.wsUrl, {
    authToken: config.apiKey,
    transport: transport as ConstructorParameters<typeof Socket>[1] extends {
      transport?: infer T;
    }
      ? T
      : never,
  });
  const channel = socket.channel("control", config.join as object);

  // --- Initial-connect watchdog (OSS-623) ----------------------------------
  // Phoenix treats a failed FIRST connect exactly like a dropped one: it retries
  // forever and reports transport errors as reconnect churn. Worse, the join
  // push's own `timeout` never fires in that state — `Channel.onError` calls
  // `joinPush.reset()` while the channel is joining, which detaches the reply
  // binding the armed timeout would have triggered — so without this watchdog
  // the await below hangs indefinitely and a wrong host surfaces only as a
  // supervising manager's settle deadline, with no cause attached.
  //
  // Everything here keys off "has the socket EVER opened": a socket that never
  // opened is an unreachable host (reject, naming it), while one that opened and
  // later dropped is a reconnect episode owned by the health state machine
  // below. Phoenix passes the same distinction to `onError` as its third
  // argument (`establishedConnections`), so both signals are checked.
  //
  // WHY the cause comes from an HTTP probe and not from the socket: the
  // WebSocket transport does not report one. Node's global WebSocket dispatches
  // an identical, detail-free error for a host that does not resolve, a refused
  // port, and a host answering HTTP with no socket mounted — so the transport
  // error alone can neither name the cause nor tell a permanent
  // misconfiguration from a gateway that is still booting. `diagnoseEndpoint`
  // asks the same origin over HTTP, which does distinguish them. A transport
  // that DOES expose an OS code (the `ws` package, custom transports) is still
  // trusted directly and needs no probe.
  const endpoint = describeEndpoint(config.wsUrl);
  // Declared here (not in the health block below) because the connect watchdog
  // tears the socket down on failure and must mark that teardown intentional.
  let closingIntentionally = false;
  let everConnected = false;
  let initialJoinSettled = false;
  // Newest control-topic join reply, refreshed on every successful (re)join.
  // Read through `providerStates()` below rather than exposed raw.
  let controlJoinReply: unknown;
  let lastTransportError: string | undefined;
  let lastTransportCode: string | undefined;
  let lastTransportRaw: unknown;
  // Set by the per-outage endpoint probe (see `probeOutage`), which can explain
  // a refused reconnect the WebSocket layer reports without detail. Preferred
  // over `lastTransportError` when present, and cleared when the outage ends.
  let lastOutageDiagnosis: string | undefined;
  let connectDeadline: ReturnType<typeof setTimeout> | undefined;
  // The initial connect settles from several places (the join push's reply
  // hooks, a non-retryable transport error, the connect deadline), so the
  // resolvers are hoisted out of the promise rather than closed over by the
  // join hooks alone. The executor runs synchronously, so both are assigned
  // before `socket.connect()` can dispatch anything.
  let settleConnect!: () => void;
  let failConnect!: (err: Error) => void;
  const initialConnect = new Promise<void>((resolve, reject) => {
    settleConnect = resolve;
    failConnect = reject;
  });
  const clearConnectDeadline = (): void => {
    if (connectDeadline !== undefined) {
      clearTimeout(connectDeadline);
      connectDeadline = undefined;
    }
  };
  // The HTTP diagnosis runs at most once per connect, and only after the socket
  // has already failed to open. Its budget stays well under the connect window
  // so a verdict is normally in hand by the time the window elapses.
  const probeTimeoutMs = Math.min(3_000, connectTimeoutMs);
  let diagnosis: Promise<EndpointDiagnosis | undefined> | undefined;
  const startDiagnosis = (): Promise<EndpointDiagnosis | undefined> => {
    if (diagnosis === undefined) {
      diagnosis = diagnoseEndpoint(
        config.wsUrl,
        probeTimeoutMs,
        config.diagnosticFetch,
      );
      // A verdict of "this can never work" short-circuits the connect window.
      void diagnosis.then((result) => {
        if (result?.nonRetryable) failUnreachable();
      });
    }
    return diagnosis;
  };
  // A reconnect probe is per OUTAGE, not per process: `diagnosis` above is
  // memoised for the life of the connect, so reusing it would report a stale
  // verdict for a later, different outage. Reset by `enterOnline`.
  let outageProbe: Promise<void> | undefined;
  // Counts healed outages, so a probe that resolves late can tell whether the
  // episode it was investigating is still the current one.
  let outageEpisode = 0;
  /**
   * Ask the endpoint over HTTP why it will not take us back. A refused upgrade
   * (a rejected/rotated project API key) is indistinguishable at the WebSocket
   * layer from a gateway that is simply down, and Phoenix retries both forever —
   * so without this the operator sees nothing at all (OSS-670).
   */
  const probeOutage = (): void => {
    if (outageProbe !== undefined) return;
    // Stamp the episode this probe belongs to. A probe is slower than a
    // reconnect can be, so its verdict may land AFTER the link healed; applying
    // it then would latch this outage's cause onto the next, unrelated one.
    const episode = outageEpisode;
    outageProbe = diagnoseEndpoint(
      config.wsUrl,
      probeTimeoutMs,
      config.diagnosticFetch,
    ).then(
      (result) => {
        if (result === undefined || episode !== outageEpisode) return;
        lastOutageDiagnosis = describeRefusedUpgrade(result);
      },
      () => undefined,
    );
  };
  /** Reject the initial connect as unreachable and stop the retry loop. */
  const failUnreachable = (): void => {
    if (initialJoinSettled) return;
    initialJoinSettled = true;
    clearConnectDeadline();
    // The caller never gets a session it could disconnect, so tear the socket
    // down here rather than leave Phoenix retrying a host that will not answer.
    // Done synchronously, before the (async) diagnosis is awaited below, so the
    // retry loop stops at the moment the decision is made.
    closingIntentionally = true;
    socket.disconnect();
    void (async () => {
      // Prefer the probe's verdict — it is the only signal that names the cause.
      // A transport that already exposed an OS code needs no probe, so only an
      // ALREADY-started diagnosis is awaited in that case.
      const probed =
        lastTransportCode !== undefined
          ? await diagnosis
          : await startDiagnosis();
      const cause = probed?.cause ?? lastTransportRaw;
      const retryable =
        !(
          lastTransportCode !== undefined &&
          NON_RETRYABLE_TRANSPORT_CODES.has(lastTransportCode)
        ) &&
        (probed === undefined ||
          (!probed.nonRetryable &&
            (probed.status === undefined || probed.status >= 500)));
      failConnect(
        new RealtimeGatewayUnreachableError(
          endpoint,
          probed?.text ?? lastTransportError,
          connectTimeoutMs,
          {
            ...(cause !== undefined ? { cause } : {}),
            retryable,
          },
        ),
      );
    })();
  };
  socket.onOpen(() => {
    everConnected = true;
    clearConnectDeadline();
  });
  socket.onError((error, _transport, establishedConnections) => {
    const detail = describeTransportError(error);
    // A drop after a successful connect belongs to the reconnect path — but it
    // must still be RECORDED, or the health observer reports an outage with no
    // cause at all (the `{ meta: undefined }` give-up log, OSS-670).
    if (everConnected || establishedConnections > 0) {
      lastTransportError = detail.text ?? lastTransportError;
      lastTransportCode = detail.code ?? lastTransportCode;
      // Only probe when the transport did NOT name the cause. A transport that
      // exposes an OS code (`ECONNRESET`, `ECONNREFUSED`) has already said what
      // happened, and the probe would both waste a request and overwrite a
      // better answer — the same trust rule the initial-connect path applies.
      if (detail.code === undefined) probeOutage();
      return;
    }
    lastTransportRaw = error;
    lastTransportError = detail.text ?? lastTransportError;
    lastTransportCode = detail.code ?? lastTransportCode;
    // A host that does not exist cannot start existing: fail now rather than
    // burn the connect window on retries that are guaranteed to fail. Only a
    // transport that exposes OS codes gets here directly; for everyone else the
    // same determination comes from the HTTP diagnosis kicked off below.
    if (
      lastTransportCode !== undefined &&
      NON_RETRYABLE_TRANSPORT_CODES.has(lastTransportCode)
    ) {
      failUnreachable();
      return;
    }
    startDiagnosis();
  });
  connectDeadline = setTimeout(() => {
    connectDeadline = undefined;
    if (!everConnected) failUnreachable();
  }, connectTimeoutMs);
  (connectDeadline as unknown as { unref?: () => void }).unref?.();

  const pendingInvitations: unknown[] = [];
  const invitationHandlers: Array<(payload: unknown) => void> = [];
  const maxPendingInvitations = 1_000;
  channel.on("delivery_invitation", (payload: unknown) => {
    if (invitationHandlers.length > 0) {
      for (const handler of invitationHandlers) handler(payload);
      return;
    }
    if (pendingInvitations.length >= maxPendingInvitations) {
      if (!initialJoinSettled) {
        initialJoinSettled = true;
        clearConnectDeadline();
        closingIntentionally = true;
        socket.disconnect();
        failConnect(
          new Error(
            `realtime gateway sent more than ${maxPendingInvitations} invitations before control setup completed`,
          ),
        );
      }
      return;
    }
    pendingInvitations.push(payload);
  });

  // The control channel and its invitation handler exist before the transport
  // can open or the join can succeed, so an immediate Gateway wake is retained.
  socket.connect();

  // --- Connection-health state machine -------------------------------------
  // `disconnect()` flips `closingIntentionally` first so our own teardown —
  // which also runs these Phoenix close/error hooks — is never mistaken for an
  // unexpected drop. `gave_up` is STICKY: once the reconnect window elapses the
  // public status stays `gave_up` (a manager maps it to `error`) while Phoenix
  // keeps retrying underneath — failed retries during the SAME outage do NOT
  // re-emit `reconnecting`. It is NOT terminal, though: a SUCCESSFUL rejoin
  // restores `online` and clears the `gaveUp` latch, which re-arms the window so
  // a genuinely fresh drop episode can enter `reconnecting` and give up again on
  // its own bounded schedule. Net: state agrees with the transport rather than
  // flapping `reconnecting`↔`gave_up` on every failed retry of a dead link.
  // (`closingIntentionally` is declared with the connect watchdog above, which
  // also tears the socket down and must mark that teardown intentional.)
  let connectionState: RealtimeGatewayConnectionState = "online";
  const stateCallbacks: Array<
    (
      s: RealtimeGatewayConnectionState,
      detail?: RealtimeGatewayConnectionDetail,
    ) => void
  > = [];
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  // Set true when the give-up window fires; suppresses further `reconnecting`
  // emissions until a successful rejoin (`enterOnline`) clears it.
  let gaveUp = false;
  const clearGiveUpTimer = (): void => {
    if (giveUpTimer !== undefined) {
      clearTimeout(giveUpTimer);
      giveUpTimer = undefined;
    }
  };
  /** Build the cause attached to a non-`online` transition, or `undefined`. */
  const currentDetail = (): RealtimeGatewayConnectionDetail | undefined => {
    const reason = lastOutageDiagnosis ?? lastTransportError;
    if (reason === undefined && lastTransportCode === undefined) {
      return undefined;
    }
    return {
      ...(reason !== undefined ? { reason } : {}),
      ...(lastTransportCode !== undefined ? { code: lastTransportCode } : {}),
    };
  };
  const emitState = (next: RealtimeGatewayConnectionState): void => {
    if (closingIntentionally || connectionState === next) {
      return;
    }
    connectionState = next;
    const detail = next === "online" ? undefined : currentDetail();
    for (const cb of stateCallbacks) {
      try {
        cb(next, detail);
      } catch {
        // Isolate observers: a throwing callback must not skip later ones or
        // propagate back into Phoenix's socket/join dispatch.
      }
    }
  };
  const enterReconnecting = (): void => {
    if (closingIntentionally) return;
    // Sticky give-up: once the window has fired we stay `gave_up` while Phoenix
    // keeps retrying a dead link, so a failed retry during the SAME outage must
    // NOT re-enter `reconnecting`. Only a successful rejoin (`enterOnline`)
    // clears the latch and re-arms the window for a genuinely fresh drop.
    if (gaveUp) return;
    // Arm the give-up window on the FIRST drop of an outage episode; a later
    // drop while still reconnecting keeps the original deadline so a flapping
    // connection that never stabilizes still gives up after one bounded window.
    if (giveUpTimer === undefined) {
      giveUpTimer = setTimeout(() => {
        giveUpTimer = undefined;
        gaveUp = true;
        emitState("gave_up");
      }, giveUpMs);
      (giveUpTimer as unknown as { unref?: () => void }).unref?.();
    }
    emitState("reconnecting");
  };
  const enterOnline = (): void => {
    // A successful (re)join heals the outage: clear the sticky latch and the
    // give-up timer so a FUTURE drop episode re-arms its own bounded window and
    // can transition `reconnecting` → `gave_up` again.
    gaveUp = false;
    clearGiveUpTimer();
    // The outage is over: drop its evidence so the NEXT one is diagnosed on its
    // own rather than inheriting this one's. Without clearing the transport
    // fields too, a later clean drop that reports nothing would be attributed to
    // this outage's error.
    outageEpisode += 1;
    outageProbe = undefined;
    lastOutageDiagnosis = undefined;
    lastTransportError = undefined;
    lastTransportCode = undefined;
    emitState("online");
  };

  // Capture the join push so both the initial join AND every Phoenix auto-rejoin
  // are observed: `Push.resend` (used by `channel.rejoin`) resets the received
  // response but PRESERVES `recHooks`, so the `"ok"`/`"error"`/`"timeout"` hooks
  // registered here re-fire on each rejoin reply. `initialJoinSettled` (declared
  // with the connect watchdog, which shares it) gates the one-shot connect
  // promise vs. the ongoing health transitions.
  const joinPush = channel.join(timeout);
  joinPush
    .receive("ok", (reply: unknown) => {
      // Keep the newest control reply. Because these hooks re-fire on every
      // Phoenix auto-rejoin, provider attachment state refreshes for free when
      // the socket recovers — a Channel provisioned while the runtime was
      // disconnected stops reporting `setup_required` after the next rejoin.
      controlJoinReply = reply;
      if (!initialJoinSettled) {
        initialJoinSettled = true;
        clearConnectDeadline();
        settleConnect();
      } else {
        // A Phoenix auto-rejoin succeeded — the managed path can send again.
        enterOnline();
      }
    })
    .receive("error", (reason: unknown) => {
      if (!initialJoinSettled) {
        initialJoinSettled = true;
        clearConnectDeadline();
        // The join failed, so the caller never gets a session it could
        // disconnect — tear the socket down here rather than leak it. Mark
        // the teardown intentional so it does not arm the give-up window.
        closingIntentionally = true;
        socket.disconnect();
        // The hard-cut control topic has one join-error path and no compatibility
        // mapping for prior setup or listener-generation states.
        failConnect(new RealtimeGatewayJoinError(reason));
      } else {
        // A rejoin failed (e.g. credentials revoked server-side). Phoenix
        // keeps retrying; surface reconnecting and let the window bound it.
        enterReconnecting();
      }
    })
    .receive("timeout", () => {
      if (!initialJoinSettled) {
        initialJoinSettled = true;
        clearConnectDeadline();
        closingIntentionally = true;
        socket.disconnect();
        failConnect(
          new RealtimeGatewayJoinError(undefined, {
            message: "realtime gateway session join timed out",
            retryable: true,
          }),
        );
      } else {
        enterReconnecting();
      }
    });

  // Settles on the join reply, or — when the socket never opens at all — on the
  // connect watchdog above.
  await initialConnect;

  const wrapChannel = (
    joinedChannel: Channel,
    joinReply: unknown,
  ): RealtimeGatewayDeliveryChannel => ({
    joinReply,
    push: (event, payload) =>
      new Promise((resolve, reject) => {
        joinedChannel
          .push(event, payload as object, timeout)
          .receive("ok", (reply: unknown) => resolve(reply))
          .receive("error", (reason: unknown) =>
            reject(
              new RealtimeGatewayPushError(
                event,
                extractReasonCode(reason),
                reason,
              ),
            ),
          )
          .receive("timeout", () =>
            reject(
              new Error(`realtime gateway session push ${event} timed out`),
            ),
          );
      }),
    on: (event, handler) => {
      if (joinedChannel === channel && event === "delivery_invitation") {
        invitationHandlers.push(handler);
        const buffered = pendingInvitations.splice(
          0,
          pendingInvitations.length,
        );
        for (const payload of buffered) handler(payload);
        return;
      }
      joinedChannel.on(event, handler);
    },
    join: async (topic, payload) => {
      const child = socket.channel(topic, payload as object);
      try {
        const childReply = await joinPhoenixChannel(child, timeout);
        return wrapChannel(child, childReply);
      } catch (error) {
        // Phoenix retains channels created via socket.channel until leave.
        try {
          child.leave();
        } catch {
          // Best-effort cleanup of a failed join.
        }
        throw error;
      }
    },
    onClose: (handler) => {
      joinedChannel.onClose(handler);
    },
    leave: () => {
      joinedChannel.leave();
    },
  });

  // Drop notification: Phoenix fires the socket's `onClose`/`onError` AND the
  // channel's `onError` for the same underlying drop (see `socket.js`'s
  // `onConnClose` → `triggerChanError`), so guard with a fired flag rather
  // than invoking every registered callback once per event.
  //
  // `closeFired` only dedupes the hooks *within* a single drop episode.
  // Phoenix's `Socket` auto-reconnects under the hood and this session
  // persists across that reconnect, so the latch is reset on `socket.onOpen`
  // — otherwise a second, later drop after a successful rejoin would never
  // notify again.
  let closeFired = false;
  const closeCallbacks: Array<() => void> = [];
  const notifyClose = (): void => {
    if (closingIntentionally || closeFired) return;
    closeFired = true;
    for (const cb of closeCallbacks) {
      try {
        cb();
      } catch {
        // Fire-and-forget notification path invoked from inside Phoenix's
        // socket/channel close/error dispatch — a throwing callback must not
        // skip later callbacks or propagate back into Phoenix's dispatch.
      }
    }
  };
  socket.onOpen(() => {
    closeFired = false;
  });
  // A socket-level drop begins a reconnect episode; the "back online" signal
  // comes from a successful (re)join (the join-push `"ok"` hook above), NOT from
  // the socket merely reopening — the channel may still be rejoining.
  socket.onClose((event) => {
    notifyClose();
    enterReconnecting();
    // Phoenix treats code 1000 as terminal and does not schedule its reconnect
    // timer. For a live managed session, only our own disconnect is terminal.
    if (!closingIntentionally && event?.code === 1000) {
      socket.disconnect(() => {
        if (!closingIntentionally) socket.connect();
      });
    }
  });
  socket.onError(() => {
    notifyClose();
    enterReconnecting();
  });
  // A CHANNEL-level close/error is ALSO non-sendable: Phoenix can error and
  // rejoin a channel while the socket stays open (so the socket handlers above
  // never fire), yet pushes can't send in the meantime. Route it through the
  // same health transition. `enterReconnecting`/`emitState` dedupe naturally, so
  // when a socket drop co-fires the socket AND channel hooks it is still one
  // `reconnecting` transition; a channel-only drop is now covered too.
  channel.onClose(() => {
    notifyClose();
    enterReconnecting();
  });
  channel.onError(() => {
    notifyClose();
    enterReconnecting();
  });

  return {
    ...wrapChannel(channel, undefined),
    providerStates: () => parseChannelProviderStates(controlJoinReply),
    onClose: (cb) => {
      closeCallbacks.push(cb);
    },
    onStateChange: (cb) => {
      stateCallbacks.push(cb);
      // Replay current health so late subscribers (e.g. ChannelManager after
      // activation) cannot miss a drop that occurred before registration.
      if (connectionState !== "online") {
        try {
          const reason = lastOutageDiagnosis ?? lastTransportError;
          cb(connectionState, {
            ...(reason !== undefined ? { reason } : {}),
            ...(lastTransportCode !== undefined
              ? { code: lastTransportCode }
              : {}),
          });
        } catch {
          // Observer isolation: one bad callback must not break others.
        }
      }
    },
    disconnect: () => {
      closingIntentionally = true;
      clearGiveUpTimer();
      socket.disconnect();
    },
  };
}

/** Join a Phoenix channel and reject with its bounded reply reason. */
function joinPhoenixChannel(
  channel: Channel,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    channel
      .join(timeoutMs)
      .receive("ok", (reply: unknown) => resolve(reply))
      .receive("error", (reason: unknown) =>
        reject(
          new Error(
            `realtime gateway delivery join failed: ${safeReason(reason)}`,
          ),
        ),
      )
      .receive("timeout", () =>
        reject(new Error("realtime gateway delivery join timed out")),
      );
  });
}

/**
 * Render the gateway endpoint for diagnostics: the configured URL without its
 * query string or fragment. The socket's auth token travels as a WebSocket
 * subprotocol rather than in the URL, but a caller-supplied query string is not
 * ours to assume is safe to echo into an error message or log.
 */
function describeEndpoint(wsUrl: string): string {
  try {
    const parsed = new URL(wsUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return wsUrl.split(/[?#]/)[0] ?? wsUrl;
  }
}

/**
 * Extract a human-readable cause and an OS-level error code from whatever a
 * WebSocket implementation dispatches on `error`.
 *
 * The shape varies: Node's WebSocket wraps the real failure (an `Error` with a
 * `code` such as `ENOTFOUND`) inside the dispatched `ErrorEvent`, `ws` dispatches
 * that `Error` directly, and browsers dispatch a deliberately detail-free
 * `Event`. So walk `.error`/`.cause` a few levels, keeping the FIRST code seen
 * and the DEEPEST message (the outer one is typically a generic
 * "connection error" wrapper).
 */
function describeTransportError(error: unknown): {
  text?: string;
  code?: string;
} {
  if (typeof error === "string") {
    return error.length > 0 ? { text: error } : {};
  }
  let node: unknown = error;
  let code: string | undefined;
  let message: string | undefined;
  for (
    let depth = 0;
    depth < 5 && typeof node === "object" && node !== null;
    depth++
  ) {
    const nodeCode = (node as { code?: unknown }).code;
    if (
      code === undefined &&
      typeof nodeCode === "string" &&
      nodeCode.length > 0
    ) {
      code = nodeCode;
    }
    const nodeMessage = (node as { message?: unknown }).message;
    if (typeof nodeMessage === "string" && nodeMessage.length > 0) {
      message = nodeMessage;
    }
    node =
      (node as { error?: unknown }).error ??
      (node as { cause?: unknown }).cause;
  }
  // Prefer the message, but make sure the code is visible in it either way — the
  // code is what a reader searches for.
  const text =
    message !== undefined
      ? code !== undefined && !message.includes(code)
        ? `${code}: ${message}`
        : message
      : code;
  return {
    ...(text !== undefined ? { text } : {}),
    ...(code !== undefined ? { code } : {}),
  };
}

/** Render an unknown channel reply reason as a short string for errors. */
function safeReason(reason: unknown): string {
  if (typeof reason === "string") return reason;
  try {
    // `JSON.stringify` returns the *value* `undefined` (not the string
    // "undefined") for `undefined`, functions, and symbols, so guard against
    // that here — this function must never return anything but a string.
    const serialized = JSON.stringify(reason);
    return serialized ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Extract a structured Phoenix reply code for packet error diagnostics.
 */
function extractReasonCode(reason: unknown): string | undefined {
  if (typeof reason === "string") return reason;
  if (typeof reason !== "object" || reason === null) return undefined;
  const coded = reason as { code?: unknown; reason?: unknown };
  if (typeof coded.code === "string") return coded.code;
  if (typeof coded.reason === "string") return coded.reason;
  return undefined;
}
