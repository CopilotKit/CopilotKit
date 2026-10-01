# @copilotkit/learning

Capture how people use your web app: clicks, page changes, and network metadata. Each interaction becomes an AG-UI `CUSTOM` event, and batches go to a sink you provide.

By default, nothing reads DOM text, input values, headers, bodies, query strings, or hashes.

```ts
import { createCollector, httpSink } from "@copilotkit/learning";

const collector = createCollector({
  sink: httpSink("/api/learning-events"),
  routes: ["/deals/:id"],
});

collector.start({ trajectoryId: crypto.randomUUID() });
```

With CopilotKit, pass `learning` to `CopilotKitProvider` instead. Core then adds the Thread, message, tool call, and run to each event.

Docs: https://docs.copilotkit.ai/intelligence/capture-interactions
