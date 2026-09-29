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

Every event has a UUID `id` and a Unix millisecond `timestamp`. User actions and their associated outcomes share an `actionId`; standalone screen observations have no action ID. New capture also includes a bounded `page` observation unless `capturePage: false` is set:

- `interaction`: a trusted click, committed change, submission, supported command shortcut, drag/drop, or public text selection, with the element's tag, role, filtered accessible name, control name, optional `data-learning-id`, observed finite control state, and bounded semantic screen context.
- `request`: fetch/XHR method, filtered service pathname, bounded public JSON body fields, response status, duration, and success/error/aborted outcome. `attribution` distinguishes `user-action` from `response-continuation`; the latter includes a `parentRequestId`.
- `dom-change`: bounded structural counts, plus updated target/context snapshots when the immediate action changes them. Text-only changes and property-only control updates are observable even when no element is added or removed.
- `response`: filtered JSON actually consumed by the application through fetch `json()`/`text()`, or a completed XHR JSON/text response. It retains the initiating request ID, method, URL and page; headers and streaming readers are not inspected.
- `context`: a standalone semantic observation at startup, same-document navigation, or a changed screen. These carry `trigger: "initial"`, `"navigation"`, or `"screen-change"`, without an action ID. Screen changes are coalesced over 300 ms and are capped at ten per minute. The existing `"request-completed"` observation retains its request/action IDs. Observations do not establish causality.

Capture observes user actions, including committed field changes; it does not record keystrokes. Synthetic DOM events are ignored. Request correlation starts in the trusted interaction task, then can follow direct continuations of a captured fetch response and its consumed body (for example, `await fetch`, `await response.json()`, then another fetch). Each continuation scope closes at the next microtask boundary. Nothing stays active while body bytes arrive, and later timer/debounced work is excluded. An intervening trusted action or input, ambiguous simultaneous response origins, cleanup, a 30-second action lifetime, or the shared request cap prevents further correlation. This is a heuristic, not an asynchronous execution tracer: unrelated microtasks in the same settlement checkpoint can be correlated, while Promise combinators, arbitrary extra awaits, cached responses consumed later, cloned responses, XHR response-handler chains, and streaming readers are not traced. Continuation attribution is labeled explicitly rather than presented as proof of causality.

DOM outcomes are collected in that same short scope. The observer watches child lists, text nodes and selected accessibility/state attributes; counts saturate at 100, and each observer delivery inspects at most 100 records. Requests outside an interaction scope are omitted. Separate screen observations can capture semantic updates without attributing them to an action. Each action can emit at most one DOM summary. Request completions may arrive after the action scope closes. A successful HTTP response does not establish a successful business outcome. Immediate outcomes are compared once at task close, including finite control properties that do not generate MutationObserver records.

When context capture is enabled, an eligible request completion schedules one additional semantic observation after 50 ms. It is canceled after an intervening trusted action (including an excluded private action or later field input), capture cleanup, or removal of the original screen scope. Unchanged observations are omitted. This bounded observation can miss later UI updates and does not establish request causality; it does not open a longer window for request capture or watch ongoing background activity.

## Page context

`page: { pathname: "/reviews/inbox" }` identifies where an observation occurred. Interaction, DOM and post-request context events sample the current pathname at their own observation. Requests retain the pathname from request initiation, even if the response arrives after navigation. If a click handler navigates before starting a request, that request can have a different page from its initiating click. Page metadata does not change the existing conservative request-correlation window.

Only HTTP(S) pathnames are included: never the origin, full URL, query, fragment, title, referrer or user agent. Basic segment filtering replaces numeric IDs, opaque-looking tokens, email/credential patterns, malformed escapes, encoded separators and control characters with `:redacted`, retaining slash structure and adding `redacted: true`. Credential keys also redact the following value. At most two percent-decodes are inspected; residual escapes are redacted. Both the original and filtered path are capped at 1,024 UTF-8 bytes. Oversized paths produce `page: { omitted: "size-limit" }`; unsupported or unreadable locations produce `page: { omitted: "unsupported-location" }`. The user event is still recorded.

This is a heuristic, not anonymization: arbitrary personal names and meaningful slugs can still pass, while some legitimate long routes can be redacted. Use `capturePage: false` for sensitive routes. This option is independent of `captureAccessibleNames`, `captureTextValues` and `captureContext`. Navigation can emit a standalone context event; page metadata remains optional in the event type for older or manually authored events.

## Semantic context

Capture uses normal accessibility markup: button/link text, native labels, `aria-label`, `aria-labelledby`, fieldset legends, headings, named regions/forms, and `role="status"`, `role="alert"`, or `output` elements. Private, hidden, and editable descendants are excluded during text traversal. Names and semantic text must pass the same basic filters as explicit labels. These are bounded observations, not a complete accessibility-tree implementation.

State includes observed checked, expanded, pressed, selected and disabled values, plus at most four filtered selected option labels. Option values are never read. State is the value observed at the event timestamp: for example, native checkbox activation may happen before the click listener, so it is not labeled as the previous value.

A native `change` on a text/search input or textarea also includes `text: { value: "Move the supplier dinner to Friday" }`. Capture reads the finished field edit, including an empty string when cleared, rather than streaming keystrokes. While a field is being edited, context reports `text.omitted: "in-progress"` until the edit commits. A native change often happens on blur; it does not prove the application submitted or saved the text. Text is limited to 1,024 UTF-16 code units and 2 KiB of UTF-8. Oversized or suspicious values are omitted in full with `text.omitted`, rather than truncated. Private fields and CopilotKit's own chat composer text stay excluded. Contenteditable commits are observed on blur; opaque canvas editors are not covered.

Set `captureTextValues: false` to retain interaction metadata without field text. No per-field marker is needed for ordinary task notes; mark application-specific private fields explicitly.

Each interaction can include `context.items`: semantic status text, relevant headings, the nearest group and named region, finite-state controls, and explicitly designated domain text. Status/headings/groups take priority within the item budget; duplicate region/heading labels and unselected radio alternatives are omitted. The scope is the nearest main/dialog, otherwise a nearby named section/form, otherwise the document body. Context visits at most 256 nodes (including name-text traversal), includes at most eight items and fits within 2 KiB of UTF-8 JSON. `truncated: true` records when those bounds prevent a complete observation. Context is emitted initially and when it changes, deduplicated against the last emitted observation. Omitted context means unchanged; an explicit `{ items: [] }` clears prior context. Consumers should retain the latest snapshot while reading the ordered callback stream. Per-thread delivery adapters must restore a current snapshot when a new thread starts receiving this stream; global deduplication alone is not a substitute for per-thread context.

Bounded visible paragraphs, lists and table cells supply context. To prioritize application-specific context, mark a short domain summary explicitly:

```html
<p data-learning-context>Order total: $48</p>
<p role="status">Awaiting approval</p>
```

The marker permits filtered text capture; it does not override privacy exclusions or make the text safe. Do not mark a whole application or private document. Unmarked domain facts may remain unavailable to a trajectory consumer.

Context content permits common currency-prefixed amounts with up to six integer digits, optional comma grouping and an optional two-digit decimal fraction (for example, `$84.50` or `$1,234.56`). Only complete bounded currency tokens bypass the numeric heuristic. Long account/card/phone sequences, emails, credentials and private descendants remain excluded. This exception does not change ordinary button, input, or other control-label filtering.

Set `captureContext: false` to omit screen context while retaining target names/state and changed text. Set `captureAccessibleNames: false` to omit names, selected option labels, semantic context, and changed text together; filtered control identifiers and finite boolean states remain available.

## Privacy and limits

The default API allowlist is same-origin `/api`. Set explicit path prefixes for other endpoints or absolute prefixes for other origins. Prefixes match path segment boundaries. The event URL retains the allowed origin and filtered pathname: `/api/orders/12345/confirm?token=secret` becomes `https://your-app.example/api/orders/:redacted/confirm`. It uses the same bounded segment filtering as page metadata; query strings and fragments are excluded. If the full path exceeds its bound, only the filtered matching prefix remains. Do not put personal data in routes or configured prefixes; unmarked private slugs can pass basic heuristics.

Capture can inspect JSON-string request bodies, but never consumes or clones request streams and never reads headers, query strings, fragments or full DOM snapshots. Filtered response observations are described below. For a captured request, `body.fields` contains filtered fields and `omittedFieldCount` / `omissionReason` disclose incomplete capture. JSON objects are bounded to 16 KiB input, 20 fields, 32 visited nodes, depth three, and 2 KiB output. Sensitive key hints, identifying values, and names/IDs of private or hidden native controls in the light DOM are omitted. Unsupported bodies (including `Request` streams, FormData and binary data), malformed JSON, and over-limit input are omitted with a reason. Private field aliases cannot be inferred: retain the control name in the JSON or use a sensitive field name. Set `captureRequestBodies: false` to omit all request bodies. Both `captureTextValues: false` and `captureAccessibleNames: false` also suppress bodies. Changed field text passes separate checks for sensitive field hints and common email, URL, phone/card-number, and credential patterns. Unmarked names or confidential prose may still pass: mark private fields yourself. Accessible names are limited to 80 characters; short semantic prose can retain an excerpt of up to 160 characters after inspecting up to 512 characters, omitting common email, long-number, URL, and sensitive-token patterns. Overlong names are omitted rather than truncated. Name extraction visits at most 64 nodes outside the shared context budget and resolves at most four labels/references. Control `name` and explicit `data-learning-id` values pass the same filtering and are restricted to short identifier characters; DOM IDs are never emitted. These application-authored values can still contain personal information: this basic filter is not anonymization.

The following markers exclude an element and its descendants, including descendants of an open shadow host:

```html
<section data-private>...</section>
<section data-sensitive>...</section>
<section data-learning-ignore>...</section>
<section data-copilotkit-learning="ignore">...</section>
```

The first three markers exclude by presence, even if their value is `false`. `.ph-no-capture` and `.ph-sensitive` also exclude. Hidden elements, `aria-hidden="true"`, password/hidden/email/telephone inputs, sensitive autocomplete tokens, and common sensitive names/IDs are excluded. These are basic safeguards; mark application-specific private areas explicitly.

`captureRequests`, `captureRequestBodies`, `captureResponseBodies`, `captureDomChanges`, `captureContext`, `captureTextValues`, and `capturePage` default to `true` after capture is explicitly enabled. Each emitted event is capped at 8 KiB of UTF-8 JSON; oversized events are omitted. `maxEventsPerMinute` defaults to 120 (maximum 1,000) across all event types; `maxRequestsPerAction` defaults to 5 (maximum 20). Set either limit to zero to disable the corresponding output. At most 100 observed requests remain in flight across a window's active capture subscriptions. Excess events/requests are dropped without buffering.

Always exclude runtime and telemetry ingestion endpoints with `excludedUrlPrefixes`. Exclusions override inclusion. Synchronous requests initiated by a callback are suppressed for that capture subscription; asynchronous sinks need an explicit URL exclusion. Callback failures are contained. Fetch promises/responses and XHR behavior are preserved, and cleanup does not overwrite another library's later instrumentation.

## Verification

```sh
pnpm exec nx run-many -t check-types,test,test:browser,publint,attw --projects=@copilotkit/learning
```

Browser tests exercise actual trusted Chromium input, filtering, correlation, fetch/XHR behavior, event limits, callback failures, and cleanup. Unit tests cover privacy boundaries, SSR, React lifecycle, and request patch composition.

## Screen state, results and editing

Context can include bounded visible paragraphs, list/table content and ordinary current field values, in addition to headings, status and control state. Explicit `data-learning-context` summaries and the action's nearby controls take priority. Context remains limited to eight items, 256 inspected nodes and 2 KiB; `truncated` marks omissions. Set `captureContext: false` to omit all screen observations. Set `captureTextValues: false` to omit ordinary field values and both request and response bodies. `captureAccessibleNames: false` also disables these textual channels.

An observed focus/pointer baseline supplies `interaction.previous` on a later committed change. It is not an inferred old value. Native scalar/date controls and contenteditable commits on blur are supported; opaque canvas editors are not. A small command-key vocabulary records Control/Meta + Enter/S/Z/Y, Alt + Left/Right, and Escape. Drag/drop records source and destination labels, never transfer contents. Public text selection is limited to a single visible text node; private, editable and cross-node selections are excluded.

`captureResponseBodies: false` independently disables response contents. JSON body filtering preserves public business fields and omission metadata. Ordinary object IDs become capture-local aliases such as `{ "reference": "object-1" }`; related filtered request paths can carry the same alias. At most 256 aliases exist per capture instance and cleanup forgets them. Each event carries a `captureId` that scopes the aliases; matching identifier values do not establish entity equivalence across unrelated services. They are neither raw IDs nor persistent user identifiers. Responses retain their originating action even when they arrive after navigation; standalone screen observations follow the currently selected thread.
