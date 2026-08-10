# Realtime Gateway Error-Only Reconnect Design

## Context

Managed Channels sessions use Phoenix's JavaScript `Socket` over the runtime's
WebSocket implementation. Phoenix schedules a new connection from its transport
`close` handler. After a session has connected successfully, the Channels
wrapper also observes transport errors and reports the session as
`reconnecting`.

Node 22's built-in WebSocket has a failure mode where a failed WebSocket
upgrade, including an HTTP 502 from a temporarily unavailable gateway, emits an
`error` event without a following `close` event. In that state the Channels
wrapper reports `reconnecting`, but Phoenix never schedules another connection.
The session remains offline until its process is restarted.

## Goals

- Restore an established managed session after a transport emits `error`
  without `close`.
- Preserve Phoenix's normal reconnect behavior when transports emit both
  events.
- Avoid duplicate connection attempts and reconnects during intentional
  shutdown.
- Keep the fallback internal to `@copilotkit/channels-intelligence`; do not add
  public configuration.
- Prove the production failure mode with a deterministic regression test.

## Non-goals

- Changing initial connection diagnosis or its existing timeout.
- Replacing Phoenix's reconnect policy.
- Changing the public connection-state contract.
- Requiring Pupfood or another Channels host to add configuration.
- Treating channel-level errors as transport failures; Phoenix already rejoins
  those over an open socket.

## Considered approaches

### Internal Phoenix socket watchdog (selected)

After an established socket reports a transport error, allow a short internal
grace period for the corresponding close event. If no close or new open arrives,
cycle the Phoenix socket through `disconnect` and `connect`. This uses Phoenix's
existing channel rejoin machinery and limits the change to the transport seam
that already owns connection health.

### WebSocket event normalization

Wrap every configured WebSocket constructor and synthesize a close event after
an error. This would make Phoenix's assumptions true, but it is more invasive:
the SDK accepts custom transports, and interposing on their event properties can
change observable transport behavior.

### Runtime upgrade only

Move affected deployments to a Node release whose WebSocket emits both events.
This would recover Pupfood but leave the SDK vulnerable on supported Node 22
runtimes and other conforming transports with the same behavior.

## Detailed design

The existing socket-level error handler will arm one private, fixed-delay timer
only after the socket has connected at least once. The timer is an escape hatch
for a missing close event, not a replacement backoff policy.

The timer will be cleared when any of these occur:

- the socket emits `close`, because Phoenix has received the event that drives
  its normal reconnect timer;
- the socket opens, because the transport is live again;
- the session disconnects intentionally;
- an earlier watchdog fires.

When the timer fires and the session is still active, it will call Phoenix
`disconnect` and reconnect from the disconnect callback. Phoenix then creates a
fresh WebSocket and rejoins the existing control channel. The existing join-push
`ok` observer returns connection health to `online` only after that logical
rejoin succeeds.

Only one watchdog may be armed at a time. Repeated error notifications during
the same stalled attempt therefore cannot create concurrent reconnect cycles.
The close and open handlers clear the timer before proceeding, preventing a
late timer from racing Phoenix's ordinary recovery.

The watchdog delay is a 100 ms module-private constant. It is long enough for a
transport's normally paired close event to arrive, while remaining far shorter
than the existing reconnect give-up window. It is deliberately not exposed
through `ConnectRealtimeGatewayOptions`: callers should not need to understand
or tune an event-compatibility workaround.

## State and error behavior

The first error continues to:

- capture transport details and start the existing per-outage endpoint probe;
- notify drop observers once for the outage episode;
- transition connection health to `reconnecting`.

The fallback does not introduce a new public state or error. If recovery keeps
failing, the existing reconnect give-up timer still transitions the session to
`gave_up`; a later successful rejoin still self-heals it to `online`.

Initial connection failures retain their current watchdog and diagnostic path.
The new fallback applies only when `everConnected` is true, so it cannot race
initial-connect rejection or change its retry classification.

## Testing

Extend the existing fake WebSocket seam with a post-connect failure mode that:

1. connects and successfully joins on the first instance;
2. emits only `error` for the next connection attempt, with no `close`;
3. allows a later instance to open and successfully rejoin.

The regression test will assert that:

- the session enters `reconnecting` after the drop;
- the error-only attempt does not strand the session;
- Phoenix constructs a subsequent WebSocket;
- the successful control rejoin returns the session to `online`.

A companion cancellation assertion will drive a normally paired `error` and
`close`, wait beyond 100 ms, and prove the watchdog does not create an extra
socket after Phoenix's ordinary reconnect succeeds.

Existing tests cover paired error/close events, clean close recovery,
intentional disconnect, sticky `gave_up`, and channel-only rejoin behavior. They
must remain green to establish that the fallback does not duplicate or broaden
normal reconnect behavior.

Verification will run the Channels Intelligence test and type-check targets via
Nx on Node 22.

## Rollout

The change is backward compatible and requires no migration. After it is
released, managed Channel hosts receive the behavior through the normal
`@copilotkit/channels-intelligence` dependency update. Pupfood can validate the
fix first against the PR preview package before consuming the released version.
