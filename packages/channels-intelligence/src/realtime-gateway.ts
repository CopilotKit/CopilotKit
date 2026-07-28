import { Socket } from "phoenix";

/**
 * Minimal Realtime Gateway session surface used by the delivery/render
 * transport. The connector adapts its private socket implementation to this
 * contract so callers never depend on a protocol client.
 */
export interface RealtimeGatewaySession {
  push(event: string, payload: unknown): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): void;
}

/** @internal Options for {@link connectRealtimeGateway}. */
export interface ConnectRealtimeGatewayOptions {
  /** Gateway socket URL, e.g. `wss://gateway.example/socket`. */
  wsUrl: string;
  /** Runtime API key (`cpk-…`) authenticating the socket. */
  apiKey: string;
  /** Numeric project id — the session topic is `channels:project:{id}`. */
  projectId: number;
  /** Listener declaration sent as the channel join payload. */
  join: {
    runtimeInstanceId: string;
    declaredChannels: ReadonlyArray<{
      channelName: string;
      adapter: string;
      renderCapabilities?: readonly string[];
    }>;
    runtimeMetadata?: Record<string, unknown>;
    observedAt: string;
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
   * and a supervising `ChannelManager` does NOT retry activation — a
   * fail-on-first-error rule would turn a boot race into a permanently errored
   * Channel. The default is deliberately long enough to outlast a rolling
   * restart of the gateway. Causes that CANNOT resolve themselves (a host that
   * does not exist) skip the window entirely; see {@link diagnoseEndpoint}.
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
 * - `fenced`: app-api superseded this listener activation generation. Terminal
 *   for this Channel; Phoenix receives a clean close and does not auto-rejoin it.
 */
export type RealtimeGatewayConnectionState =
  | "online"
  | "reconnecting"
  | "gave_up"
  | "fenced";

const LISTENER_FENCED_EVENT = "channel.listener_fenced.v1";

/**
 * Signals that a join was rejected because the declared channel/provider is not
 * configured server-side — a setup-required condition, distinct from a generic
 * join failure. Carries `code === "SETUP_REQUIRED"` (the cross-package
 * convention a supervising `ChannelManager` detects to move a channel to
 * `setup_required` rather than `error`) and preserves the raw gateway
 * {@link RealtimeGatewaySetupRequiredError.reason}.
 *
 * A dedicated class is defined here rather than importing the runtime's
 * `ChannelSetupRequiredError` because this pure-ESM package must not take a
 * dependency on the CJS runtime package; the `code` convention keeps the two
 * decoupled.
 */
export class RealtimeGatewaySetupRequiredError extends Error {
  /** Cross-package setup-required marker read by `ChannelManager`. */
  readonly code = "SETUP_REQUIRED";
  /** The raw gateway join-error reason that classified this as setup-required. */
  readonly reason: string;
  /**
   * The non-live per-channel `state`s that classified this as setup-required
   * (e.g. `["adapter_setup_required"]`), preserved for diagnostics. Empty when
   * the gateway reported no per-channel detail. Contains no secrets.
   */
  readonly channelStates: readonly string[];
  /**
   * @param reason - The gateway's setup-required join reason.
   * @param channelStates - The offending non-live per-channel states, if any.
   */
  constructor(reason: string, channelStates: readonly string[] = []) {
    super(
      `realtime gateway session join requires setup: ${reason}` +
        (channelStates.length > 0
          ? ` (channel states: ${channelStates.join(", ")})`
          : ""),
    );
    this.name = "RealtimeGatewaySetupRequiredError";
    this.reason = reason;
    this.channelStates = channelStates;
  }
}

/**
 * Signals that a `channel_declaration_unavailable` join reject named at least
 * one declared channel in a HARD-error per-channel `state` (e.g.
 * `runtime_conflict`, `platform_setup_failed`) — a genuine failure the caller
 * must surface, NOT a setup-waiting condition. Deliberately does NOT carry the
 * `SETUP_REQUIRED` marker, so a supervising `ChannelManager` routes it to
 * `error` (rejecting `ready()`) rather than resolving to `setup_required`.
 */
export class RealtimeGatewayChannelStateError extends Error {
  /** The raw gateway join-error reason (`channel_declaration_unavailable`). */
  readonly reason: string;
  /**
   * The offending hard-error per-channel `state`s (e.g. `["runtime_conflict"]`),
   * preserved for diagnostics. Contains no secrets.
   */
  readonly channelStates: readonly string[];
  /**
   * @param reason - The gateway's join-error reason.
   * @param channelStates - The offending hard-error per-channel states.
   */
  constructor(reason: string, channelStates: readonly string[]) {
    super(
      `realtime gateway session join failed: ${reason} (channel states: ${channelStates.join(", ")})`,
    );
    this.name = "RealtimeGatewayChannelStateError";
    this.reason = reason;
    this.channelStates = channelStates;
  }
}

/**
 * Signals that the gateway socket NEVER opened — the configured `wsUrl` host is
 * wrong or unreachable (DNS miss, refused/failed TCP or TLS connect, or a host
 * that serves HTTP with no Phoenix socket mounted at the endpoint). Carries the
 * endpoint that was tried and the underlying transport error so the message
 * points at the misconfigured URL rather than at a stopwatch (OSS-623).
 *
 * Deliberately does NOT carry the `SETUP_REQUIRED` marker: an unreachable host
 * is a caller configuration error that must reject `ready()`, not a
 * setup-waiting condition a supervising `ChannelManager` would resolve to
 * `setup_required` (coordinated with OSS-622's join-failure classification).
 */
export class RealtimeGatewayUnreachableError extends Error {
  /** Cross-package marker, mirroring the `code` convention of its siblings. */
  readonly code = "GATEWAY_UNREACHABLE";
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
   * @param options - Standard error options; carries the raw transport error
   *   as `cause`.
   */
  constructor(
    endpoint: string,
    transportError: string | undefined,
    connectTimeoutMs: number,
    options?: { cause?: unknown },
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

/** What {@link diagnoseEndpoint} learned about an endpoint that would not connect. */
interface EndpointDiagnosis {
  /** Human-readable cause, phrased for the person who set `wsUrl`. */
  readonly text: string;
  /** OS-level code behind the failure, when one was exposed. */
  readonly code?: string;
  /** Whether the cause cannot clear on its own (fail now, don't wait). */
  readonly nonRetryable: boolean;
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

/**
 * Per-channel `state` values (from the gateway's `CHANNEL_STATE_KINDS`) that
 * mean a declared channel is genuinely unconfigured or waiting — a degraded
 * `setup_required` condition, not a hard failure. Any other non-`channel_live`
 * state (`runtime_conflict`, `platform_setup_failed`, `delivery_failed`,
 * `egress_failed`, `runtime_offline`, `runtime_not_declared`) is treated as a
 * hard error; see {@link classifyJoinError}.
 *
 * Verified against Intelligence `sdk_channel.ex` +
 * `libs/app-api-contracts/src/channels.ts`: the gateway rejects a join with
 * `{:error, %{"reason" => "channel_declaration_unavailable", "channels" =>
 * [%{"state" => <state>, ...}, ...]}}` whenever ANY declared channel's
 * `state != "channel_live"`, so the per-channel `state` — not the top-level
 * reason — is the real signal.
 */
const SETUP_REQUIRED_CHANNEL_STATES: ReadonlySet<string> = new Set([
  "no_channels_yet",
  "adapter_setup_required",
  "slack_setup_complete_waiting_for_runtime",
  "channel_setup_complete_waiting_for_runtime",
  "disabled_by_entitlement",
  "disabled_by_feature_flag",
]);

/**
 * TOP-LEVEL join-error reasons (distinct from the per-channel
 * `channel_declaration_unavailable` shape) that app-api may use to signal an
 * unconfigured provider. Modeled defensively for non-
 * `channel_declaration_unavailable` rejects; the canonical live-gateway signal
 * is the per-channel state classified via {@link SETUP_REQUIRED_CHANNEL_STATES}.
 */
const SETUP_REQUIRED_TOP_LEVEL_REASONS: ReadonlySet<string> = new Set([
  "adapter_setup_required",
  "not_configured",
]);

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
   * - an explicit `channel.listener_fenced.v1` gateway event → terminal `fenced`;
   *   the following clean Phoenix close is not reported as reconnecting.
   *
   * Our own {@link disconnect} is silent (it is not a drop). Distinct from
   * {@link onClose}, which is a single per-episode drop breadcrumb; this observer
   * tracks the full health lifecycle so a manager's `status()` can reflect it.
   */
  onStateChange(cb: (state: RealtimeGatewayConnectionState) => void): void;
}

/**
 * @internal Connect the SDK to a Realtime Gateway session. Socket/client
 * values stay private here; callers receive only {@link RealtimeGatewaySession}.
 *
 * The session is joined (declaring the runtime's channels) before the promise
 * resolves, so the caller can immediately stream render frames.
 *
 * @param config - Gateway URL, auth, project scope, and join declaration.
 * @returns The connected channel with a `disconnect()` teardown.
 */
export async function connectRealtimeGateway(
  config: ConnectRealtimeGatewayOptions,
): Promise<ConnectedRealtimeGatewaySession> {
  if (!Number.isInteger(config.projectId) || config.projectId <= 0) {
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
  let lastTransportError: string | undefined;
  let lastTransportCode: string | undefined;
  let lastTransportRaw: unknown;
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
      failConnect(
        new RealtimeGatewayUnreachableError(
          endpoint,
          probed?.text ?? lastTransportError,
          connectTimeoutMs,
          cause !== undefined ? { cause } : undefined,
        ),
      );
    })();
  };
  socket.onOpen(() => {
    everConnected = true;
    clearConnectDeadline();
  });
  socket.onError((error, _transport, establishedConnections) => {
    // A drop after a successful connect belongs to the reconnect path.
    if (everConnected || establishedConnections > 0) return;
    lastTransportRaw = error;
    const detail = describeTransportError(error);
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

  socket.connect();

  const channel = socket.channel(
    `channels:project:${config.projectId}`,
    config.join as object,
  );

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
  const stateCallbacks: Array<(s: RealtimeGatewayConnectionState) => void> = [];
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  // Set true when the give-up window fires; suppresses further `reconnecting`
  // emissions until a successful rejoin (`enterOnline`) clears it.
  let gaveUp = false;
  // A generation-fenced Channel is terminal. Phoenix deliberately does not
  // auto-rejoin a clean `phx_close`, and this latch prevents a later socket
  // callback from misreporting that terminal close as a reconnecting outage.
  let listenerFenced = false;
  const clearGiveUpTimer = (): void => {
    if (giveUpTimer !== undefined) {
      clearTimeout(giveUpTimer);
      giveUpTimer = undefined;
    }
  };
  const emitState = (next: RealtimeGatewayConnectionState): void => {
    if (closingIntentionally || connectionState === next) {
      return;
    }
    connectionState = next;
    for (const cb of stateCallbacks) {
      try {
        cb(next);
      } catch {
        // Isolate observers: a throwing callback must not skip later ones or
        // propagate back into Phoenix's socket/join dispatch.
      }
    }
  };
  const enterReconnecting = (): void => {
    if (closingIntentionally || listenerFenced) return;
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
    if (listenerFenced) return;
    // A successful (re)join heals the outage: clear the sticky latch and the
    // give-up timer so a FUTURE drop episode re-arms its own bounded window and
    // can transition `reconnecting` → `gave_up` again.
    gaveUp = false;
    clearGiveUpTimer();
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
    .receive("ok", () => {
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
        // Classify per-channel state (setup-waiting vs hard error) rather than
        // blanket-mapping the whole reject — a duplicate-listener conflict must
        // NOT be downgraded to `setup_required`.
        failConnect(classifyJoinError(reason));
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
        failConnect(new Error("realtime gateway session join timed out"));
      } else {
        enterReconnecting();
      }
    });

  // Settles on the join reply, or — when the socket never opens at all — on the
  // connect watchdog above.
  await initialConnect;

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
  socket.onClose(() => {
    notifyClose();
    enterReconnecting();
  });
  socket.onError(() => {
    notifyClose();
    enterReconnecting();
  });
  // The gateway sends this immediately before cleanly closing a superseded
  // Channel. Record the terminal reason before Phoenix dispatches `phx_close`
  // so the close hook below cannot imply that an auto-rejoin will occur.
  channel.on(LISTENER_FENCED_EVENT, () => {
    listenerFenced = true;
    clearGiveUpTimer();
    emitState("fenced");
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
    push: (event, payload) =>
      new Promise((resolve, reject) => {
        channel
          .push(event, payload as object, timeout)
          .receive("ok", (reply: unknown) => resolve(reply))
          .receive("error", (reason: unknown) =>
            reject(
              new Error(
                `realtime gateway session push ${event} failed: ${safeReason(reason)}`,
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
      channel.on(event, handler);
    },
    onClose: (cb) => {
      closeCallbacks.push(cb);
    },
    onStateChange: (cb) => {
      stateCallbacks.push(cb);
    },
    disconnect: () => {
      closingIntentionally = true;
      clearGiveUpTimer();
      socket.disconnect();
    },
  };
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

/**
 * Classify a Phoenix join-error reject into the error the caller should see.
 *
 * The live gateway rejects with `{ reason: "channel_declaration_unavailable",
 * channels: [{ state, … }, …] }` whenever ANY declared channel's
 * `state != "channel_live"`, so the per-channel `state` is the real signal —
 * NOT the top-level reason. Blanket-mapping the whole reject to
 * `setup_required` (the previous behavior) hid genuine failures such as a
 * duplicate-listener `runtime_conflict`.
 *
 * Classification for `channel_declaration_unavailable`:
 * - Setup-waiting (→ {@link RealtimeGatewaySetupRequiredError}) ONLY when every
 *   non-live channel is in {@link SETUP_REQUIRED_CHANNEL_STATES}.
 * - Hard error (→ {@link RealtimeGatewayChannelStateError}) if ANY non-live
 *   channel is in a hard-error state (`runtime_conflict`, `platform_setup_failed`,
 *   `delivery_failed`, `egress_failed`, `runtime_offline`, `runtime_not_declared`)
 *   — fail loud on the worst even if other channels are merely waiting.
 *
 * `runtime_not_declared` is treated as a HARD error here: during our own join
 * the runtime IS declaring itself, so the gateway reporting the channel as
 * runtime-not-declared is a server/runtime disagreement, not user setup. TODO
 * (gateway-owner): confirm this is never a benign join-vs-heartbeat race; if it
 * is, add it to {@link SETUP_REQUIRED_CHANNEL_STATES} and document why.
 *
 * When a `channel_declaration_unavailable` reject carries no parseable
 * per-channel detail, we degrade to `setup_required` (the conservative
 * "waiting" reading, matching prior behavior) rather than fail loud on absent
 * diagnostics.
 *
 * Non-`channel_declaration_unavailable` rejects fall back to the defensive
 * top-level {@link SETUP_REQUIRED_TOP_LEVEL_REASONS} set, else a generic error.
 */
function classifyJoinError(reason: unknown): Error {
  const reasonCode = extractReasonCode(reason);
  if (reasonCode === "channel_declaration_unavailable") {
    const nonLive = extractNonLiveChannelStates(reason);
    const hardErrorStates = nonLive.filter(
      (state) => !SETUP_REQUIRED_CHANNEL_STATES.has(state),
    );
    if (hardErrorStates.length > 0) {
      return new RealtimeGatewayChannelStateError(reasonCode, hardErrorStates);
    }
    return new RealtimeGatewaySetupRequiredError(reasonCode, nonLive);
  }
  if (
    reasonCode !== undefined &&
    SETUP_REQUIRED_TOP_LEVEL_REASONS.has(reasonCode)
  ) {
    return new RealtimeGatewaySetupRequiredError(reasonCode);
  }
  return new Error(
    `realtime gateway session join failed: ${safeReason(reason)}`,
  );
}

/**
 * Extract the non-`channel_live` per-channel `state`s from a join-error reject
 * payload (`{ channels: [{ state, … }, …] }`). Non-string / missing states and
 * a missing `channels` array yield an empty list (handled defensively by
 * {@link classifyJoinError}).
 */
function extractNonLiveChannelStates(reason: unknown): string[] {
  if (typeof reason !== "object" || reason === null) return [];
  const channels = (reason as { channels?: unknown }).channels;
  if (!Array.isArray(channels)) return [];
  return channels
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? (entry as { state?: unknown }).state
        : undefined,
    )
    .filter(
      (state): state is string =>
        typeof state === "string" && state !== "channel_live",
    );
}

/**
 * Extract the string reason code from a Phoenix join-error payload. The gateway
 * replies with `{ reason: "<code>" }` (surfaced as the `.receive("error", …)`
 * argument), but a bare string reason is tolerated defensively.
 */
function extractReasonCode(reason: unknown): string | undefined {
  if (typeof reason === "string") return reason;
  if (typeof reason === "object" && reason !== null) {
    const inner = (reason as { reason?: unknown }).reason;
    if (typeof inner === "string") return inner;
  }
  return undefined;
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
