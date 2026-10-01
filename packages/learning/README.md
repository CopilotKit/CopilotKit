# @copilotkit/learning

Capture how people use your web app: clicks, form edits, page changes, and network requests. Each interaction becomes an AG-UI `CUSTOM` event, and batches go to a sink you provide. This custom-sink integration is experimental and self-hosted.

Capture retains raw URLs, query strings, hashes, page titles, referrers, element text, attributes, and live control values by default. Network events include browser-visible request and response headers and body snapshots. Each body snapshot has a 4 KiB limit and an explicit status for incomplete or unavailable content. Capture does not redact these fields by default.

Use `capture`, `beforeSend`, `ignoreUrls`, and `data-copilotkit-ignore` for your app's exclusions. The deprecated `routes` option no longer masks or transforms paths.

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
