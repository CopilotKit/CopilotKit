# @copilotkit/learning

Capture product actions in a browser and deliver small, structured events to a callback. The root entry is framework independent. The package does not send data anywhere, import AG-UI, or start an agent run.

For automatic capture and delivery through a Runtime connected to CopilotKit Intelligence, set `learning={true}` on your existing `CopilotKitProvider` or `CopilotKit` provider. This integration is off by default; a `learning` configuration object also enables it unless `enabled: false` is set. Omission or `learning={false}` keeps it off. See the [product trajectories guide](https://docs.copilotkit.ai/intelligence/product-trajectories). The standalone capture APIs below start when you explicitly call or mount them.

```ts
import { startProductInteractionCapture } from "@copilotkit/learning";

const stop = startProductInteractionCapture({
  apiUrlPrefixes: ["/api/orders", "https://service.example.com/v1/tasks"],
  excludedUrlPrefixes: ["/api/copilotkit", "/api/telemetry"],
  onEvent: (event) => {
    // Send to your application-owned sink, or inspect locally.
    console.log(event);
  },
});

// Remove listeners, mutation observation, and request instrumentation.
stop();
```

In React, use the optional subpath:

```tsx
import { LearningProvider } from "@copilotkit/learning/react";

<LearningProvider
  onEvent={handleProductEvent}
  excludedUrlPrefixes={["/api/copilotkit"]}
>
  <App />
</LearningProvider>;
```

`LearningProvider` accepts the same capture options, plus `children`. It updates its callback on rerender and releases observers on unmount. Multiple providers share request instrumentation. Server rendering and `enabled: false` do not install observers.

## Events and correlation

Every event has a UUID `id`, a shared `actionId`, and a Unix millisecond `timestamp`:

- `interaction`: a trusted `click`, `change`, or `submit`, with the element's tag, accessibility role, filtered explicit label, control name, and application-authored `data-learning-id` when available.
- `request`: fetch/XHR method, matched API prefix, response status, duration, and success/error/aborted outcome.
- `dom-change`: bounded counts of added/removed elements and relevant accessibility/state attribute changes.

Capture observes user actions, including committed field changes; it does not record keystrokes. Synthetic DOM events are ignored. Request correlation is deliberately conservative: only requests started during the immediate trusted interaction scope are eligible. The scope closes on the next timer task. Delayed/debounced requests and later work after an asynchronous operation are generally omitted. This is a causal heuristic, not an asynchronous execution tracer.

DOM outcomes are counts collected in that same short scope. The observer watches child lists and `aria-expanded`, `aria-checked`, `aria-selected`, `disabled`, and `hidden`; counts saturate at 100, and each observer delivery inspects at most 100 records. Neither automatic background updates nor requests outside an interaction scope produce events. Each action can emit at most one DOM summary. Request completions may arrive after the action scope closes.

## Privacy and limits

The default API allowlist is same-origin `/api`. Set explicit path prefixes for other endpoints or absolute prefixes for other origins. Prefixes match path segment boundaries. The event URL contains **only the origin and longest matched configured prefix**: `/api/orders/customer-123?token=secret` becomes `https://your-app.example/api/orders` when `/api/orders` is configured. Do not put personal data in configured prefixes.

Capture never reads input values, request/response bodies, headers, query strings, fragments, DOM text, or snapshots. By default it includes an explicit `aria-label` (or `title`) of at most 80 characters, omitting common email, long-number, URL, and sensitive-token patterns. Set `captureAccessibleNames: false` to omit labels. Control `name` and explicit `data-learning-id` values pass the same filtering and are restricted to short identifier characters; DOM IDs are never emitted. These application-authored values can still contain personal information: this basic filter is not anonymization.

The following markers exclude an element and its descendants, including descendants of an open shadow host:

```html
<section data-private>...</section>
<section data-sensitive>...</section>
<section data-learning-ignore>...</section>
<section data-copilotkit-learning="ignore">...</section>
```

The first three markers exclude by presence, even if their value is `false`. `.ph-no-capture` and `.ph-sensitive` also exclude. Hidden elements, `aria-hidden="true"`, password/hidden/email/telephone inputs, sensitive autocomplete tokens, and common sensitive names/IDs are excluded. These are basic safeguards; mark application-specific private areas explicitly.

`captureRequests` and `captureDomChanges` default to `true`. `maxEventsPerMinute` defaults to 120 (maximum 1,000) across all event types; `maxRequestsPerAction` defaults to 5 (maximum 20). Set either limit to zero to disable the corresponding output. At most 100 observed requests remain in flight across a window's active capture subscriptions. Excess events/requests are dropped without buffering.

Always exclude runtime and telemetry ingestion endpoints with `excludedUrlPrefixes`. Exclusions override inclusion. Synchronous requests initiated by a callback are suppressed for that capture subscription; asynchronous sinks need an explicit URL exclusion. Callback failures are contained. Fetch promises/responses and XHR behavior are preserved, and cleanup does not overwrite another library's later instrumentation.

## Verification

```sh
pnpm exec nx run-many -t check-types,test,test:browser,publint,attw --projects=@copilotkit/learning
```

Browser tests exercise actual trusted Chromium input, filtering, correlation, fetch/XHR behavior, event limits, callback failures, and cleanup. Unit tests cover privacy boundaries, SSR, React lifecycle, and request patch composition.
