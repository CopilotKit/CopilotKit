# @copilotkit/learning

Capture page context, navigation, clicks, form edits, network requests, and developer events as AG-UI `CUSTOM` events. Use the authenticated Core integration to send events to CopilotKit Intelligence.

Capture retains raw URLs, query strings, hashes, page titles, referrers, element text, attributes, and live control values by default. Network events include browser-visible request and response headers and body snapshots. Each body snapshot has a 4 KiB limit and an explicit status for incomplete or unavailable content. Only passwords and credentials are replaced with `[redacted]`, in the browser:

- Values of password fields: `type="password"`, fields that had it earlier in the session (show-password toggles), fields with a credential key as `name`, and `autocomplete` `current-password`, `new-password`, or `one-time-code`.
- Values typed into password fields, wherever they appear in body snapshots, URLs, or element attributes (the last 20 values of 4 or more characters, kept in memory until stop, also when input capture is off).
- Values of credential keys such as `password`, `secret`, `api_key`, `access_token`, `authorization`, `cookie`, `jwt`, or `token` in JSON, URL-encoded, and `FormData` bodies, `key: value` text, query strings, hashes, and element attributes, including inside JSON strings nested up to four levels deep. Booleans and `null` stay.
- Element attributes named like credentials (`data-api-key`, `data-token`).
- Values of headers whose name is a credential key (`authorization`, `cookie`, `x-api-key`, `x-csrf-token`, …), plus `x-amz-security-token`, `private-token`, and `x-token`.
- URL user names and passwords (`https://user:pass@host`), which are removed anywhere in captured text.

Redaction runs on the first 16 KiB of a body, before the 4 KiB limit applies. Everything else is captured raw. Binary bodies, hand-built multipart text, XML, single-quoted objects, percent-encoded JSON inside form values, OAuth `code=` values, path tokens, and passwords shorter than 4 characters are not redacted. See [Captured data](https://docs.copilotkit.ai/intelligence/captured-data) for the matching rules and limits.

Use `capture`, `beforeSend`, `ignoreUrls`, and `data-copilotkit-ignore` for your app's exclusions. The deprecated `routes` option no longer masks or transforms paths.

Text edits are combined per field and recorded after a 300 ms pause. Committing or leaving the field, pressing Enter outside input-method composition, clicking, navigating, emitting a developer event, or stopping capture records the pending edit first. Paired `input` and `change` notifications for the same edit produce one record; a later user edit can record the same value again. Checkbox and select changes remain immediate. See [Form edit timing](https://docs.copilotkit.ai/intelligence/captured-data#form-edit-timing) for composition and delivery behavior.

## Authenticated Trajectories

Use Core to connect capture to CopilotKit Intelligence. This experimental integration targets the join and batch APIs in [Intelligence #1569](https://github.com/CopilotKit/Intelligence/pull/1569).

```ts
import { CopilotKitCore } from "@copilotkit/core";

const copilotkit = new CopilotKitCore({
  runtimeUrl: "/api/copilotkit",
  runtimeTransport: "single",
  learning: {
    onError: ({ code }) => console.warn("Trajectory capture:", code),
  },
});

const result = await copilotkit.startTrajectory();
if (result.status === "started") {
  copilotkit.emitTrajectoryEvent("deal.approved", { dealId: "deal-1" });
}

// Stop on consent withdrawal or when capture is no longer needed.
copilotkit.stopTrajectory();
```

An omitted `trajectoryId` generates a UUID. Start succeeds after Runtime authentication and the Phoenix channel join. The Runtime resolves the user on the server and sends only their ID to Intelligence. Browser-supplied identity and container IDs are ignored; container assignment is deferred. Setting `learningContainerIds` for authenticated capture produces a warning. That option applies only to custom sinks.

Capture includes page context, navigation, clicks, form edits, network requests, and developer events. Paths remain unchanged. When Runtime starts an agent run, Core sends `thread.linked` with the run's `threadId`, once for each Thread. Runtime creates the Thread before the run starts, so Intelligence can store the link. Click Thread context and agent events are deferred for this connection path.

Core sends Phoenix `events` messages with `{ events, dropped }`. It flushes after two seconds, at 50 events, or before the batch exceeds 64 KiB. Each event must fit within 16 KiB, including sequence metadata. Sizes use serialized UTF-8 JSON. The Gateway replies with `{ highestSeq, accepted, rejected }`. This receipt confirms Redis acceptance, not a Postgres commit. Postgres projection follows asynchronously. The receipt does not identify individual rejected events.

Developer events accept any JSON value. Core adds `seq` to object values. It wraps scalars, arrays, `null`, and objects that already contain `seq` as `{ data: value, seq }`, preserving the developer's data.

Sequence numbers increase for the lifetime of a Core instance, including reconnects and stop/start. They start from the Core instance's creation time in microseconds, not 0, so a new Core instance that reuses a Trajectory ID after a page reload continues above the earlier seqs. The Gateway stores each seq once per Trajectory and acknowledges a repeat as accepted, so a new Core instance can still lose events as duplicates if it starts the same ID before the earlier one's seqs run past its own start, roughly when it starts within (seqs used by the earlier instance ÷ 1000) milliseconds. Prefer a new Trajectory UUID for each Core instance when you do not need to continue one.

Capture pauses while disconnected. Reconnect requests fresh credentials. Developer events emitted during recovery count toward `dropped`; their content is not buffered. Core keeps one batch awaiting a receipt and one bounded queue; it does not resend failed batches. Known client losses are reported through `dropped`. Server rejections are already counted by the Gateway. A missing receipt reports `PERSISTENCE_UNKNOWN` through `onError`, because the server may have saved the batch. An `unauthorized` or `trajectory_mismatch` reply stops capture and reconnect attempts.

Stop cancels pending starts and reconnects. It attempts one final queued batch if no receipt is pending, then disconnects without waiting. Stop is not a guarantee that the last batch was saved. A batch still awaiting its receipt reports `PERSISTENCE_UNKNOWN`, including during a normal stop.

If a start or an established capture ends with an error and no `onError` is set, Core logs a console warning with the error code and a setup hint, such as a missing `runtimeUrl`, a Runtime without `intelligence`, or a missing `identifyUser`. Each outcome warns once per Core instance. Server error messages are never shown in the browser. Setting `onError` replaces the warning. Stops and recoverable connection loss do not warn.

### React

Capture needs a Runtime configured with `intelligence` and `identifyUser`, and a project with Trajectories enabled. Then turn capture on in the provider:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" learning>
  {children}
</CopilotKitProvider>
```

`learning` turns capture on. For options, pass an object, such as `learning={{ onError }}`. `learning={false}` or removing the prop turns capture off, which suits a consent switch: `learning={hasConsent}`.

Capture starts after mount. Without `learning.trajectoryId`, the provider generates the Trajectory ID. The ID stays the same across rerenders, React StrictMode effect replays, reconnects, and option changes. Turning capture off and on again starts a new Trajectory with a new ID. Unmounting the provider stops capture. Read the active ID from `copilotkit.trajectoryId`, or subscribe with `onTrajectoryChanged`.

Set `learning.trajectoryId` to use your own ID instead.

To decide yourself when capture starts, set `autoStart: false`. The provider configures capture and waits for your app to call `copilotkit.startTrajectory()`:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  learning={{ autoStart: false }}
>
  {children}
</CopilotKitProvider>
```

With `autoStart: false`, the provider ignores `learning.trajectoryId` and logs a console warning. Pass the ID to `startTrajectory({ trajectoryId })` instead.

Earlier versions waited for `startTrajectory()` when the object had no `trajectoryId`, for example `learning={{ onError }}`. Those objects now start capture after mount. Add `autoStart: false` to keep the manual start.

## Custom batch sinks

The original `createCollector` API supports an experimental self-hosted custom batch sink with the same browser capture defaults. It does not authenticate or connect to the Gateway.

```ts
import { createCollector, httpSink } from "@copilotkit/learning";

const collector = createCollector({
  sink: httpSink("/api/learning-events"),
});

collector.start({ trajectoryId: crypto.randomUUID() });
```

With the custom-sink integration, pass `learning` to `CopilotKitProvider` instead. Core adds Thread context and emits agent and tool events. Agent message text is included in full unless `capture.agentText` is `false`. These additions belong to the custom-sink integration, not standalone browser capture.

Event sequence numbers increase for the lifetime of the collector or Core instance, including across stop/start cycles.

Docs: https://docs.copilotkit.ai/intelligence/capture-interactions
