# @copilotkit/learning

Capture page context, navigation, clicks, and developer events as AG-UI `CUSTOM` events.

By default, nothing reads DOM text, input values, headers, bodies, query strings, or hashes.

## Authenticated Trajectories

Use Core to connect capture to CopilotKit Intelligence. This integration targets the join and batch APIs in [Intelligence #1569](https://github.com/CopilotKit/Intelligence/pull/1569).

```ts
import { CopilotKitCore } from "@copilotkit/core";

const copilotkit = new CopilotKitCore({
  runtimeUrl: "/api/copilotkit",
  runtimeTransport: "single",
  learning: {
    routes: ["/deals", "/deals/:id"],
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

An omitted `trajectoryId` generates a UUID. Start succeeds after Runtime authentication and the Phoenix channel join. The Runtime resolves the user on the server and sends only their ID to Intelligence. Browser-supplied identity and container IDs are ignored; container assignment is deferred.

Capture includes page context, navigation, clicks, and developer events. Unmatched routes become `null`. Thread linking, network capture, and agent events are deferred for this connection path.

Core sends Phoenix `events` messages with `{ events, dropped }`. It flushes after two seconds, at 50 events, or before the batch exceeds 64 KiB. Each event must fit within 16 KiB, including sequence metadata. Sizes use serialized UTF-8 JSON. The Gateway replies with `{ highestSeq, accepted, rejected }`; this receipt does not identify individual rejected events.

Developer events accept any JSON value. Core adds `seq` to object values. It wraps scalars, arrays, `null`, and objects that already contain `seq` as `{ data: value, seq }`, preserving the developer's data.

Sequence numbers increase for the lifetime of a Core instance, including reconnects and stop/start. **Use a new Trajectory UUID after a page reload or when creating a new Core instance.** The join API does not return a sequence cursor, so resuming an old ID in a new instance can silently discard events as duplicates.

Capture pauses while disconnected. Reconnect requests fresh credentials. Core keeps one batch awaiting a receipt and one bounded queue; it does not resend failed batches. Known client losses are reported through `dropped`. Server rejections are already counted by the Gateway. A missing receipt reports `PERSISTENCE_UNKNOWN` through `onError`, because the server may have saved the batch.

Stop cancels pending starts and reconnects. It attempts one final queued batch if no receipt is pending, then disconnects without waiting. Stop is not a guarantee that the last batch was saved.

In React, pass the same configuration to `CopilotKitProvider`. Set `learning.trajectoryId` to start automatically, or call the Core methods to control capture.

## Custom batch sinks

The original `createCollector` API supports a custom batch sink, including optional network metadata capture. It does not authenticate or connect to the Gateway.

```ts
import { createCollector, httpSink } from "@copilotkit/learning";

const collector = createCollector({
  sink: httpSink("/api/learning-events"),
  routes: ["/deals/:id"],
});

collector.start({ trajectoryId: crypto.randomUUID() });
```

Docs: https://docs.copilotkit.ai/intelligence/capture-interactions
