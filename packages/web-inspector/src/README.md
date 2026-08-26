# Web Inspector source map

Start with `index.ts`. It deliberately contains only the published interface.

Load one implementation module at a time:

- `inspector-elements.ts` — the root custom element: lifecycle, layout, menu
  coordination, telemetry, launcher signals, and feature composition.
- `components/thread-list.ts` — the thread-list custom element and its
  `threadSelected` event.
- `components/thread-inspector.ts` — the thread timeline, state, raw-event,
  and detail-panel custom element.
- `components/memory-list.ts` — the learning and semantic-recall custom
  element.
- `components/web-inspector-styles.ts` — root inspector visual styling, kept
  separate from lifecycle and interaction behavior.
- `lib/thread-debugger.ts` — typed thread-debugger data, example threads,
  timeline view-models, and JSON rendering helpers.
- `lib/capabilities.ts` — the pure capabilities view model.
- `lib/memory-recall.ts` — pure semantic-recall relevance calculations.

The root element intentionally coordinates existing custom-element seams;
these modules own their rendering and domain transformations. Keep new pure
view-model behavior in `lib/`, and only add a new custom-element seam when it
has an independent public interaction contract.
