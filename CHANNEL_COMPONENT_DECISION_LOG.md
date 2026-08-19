# Channel Components V2 Decision Log

This log records product and API decisions for Channel Components V2. It is the source for `CHANNEL_COMPONENTS_V2.md`.

## Round 1: Product shape

Date: 2026-08-12

1. V2 ships for both Slack and Microsoft Teams. The first release does not stage one platform before the other.
2. Developers define one channel component through one shared contract. The render tree may contain Slack-specific and Teams-specific JSX elements.
3. The streaming schema library will live as a standalone public package in the CopilotKit repository. It must not depend on the Channels SDK. Channels will be its first major use case.
4. We will evolve `defineChannelComponent` in place for Channels SDK v0.9. We will not add a parallel `defineChannelComponentV2` API. The current API is a subset of the target design, so the change does not need to break existing definitions unless a later decision requires it.
5. A streamed component tool call creates one channel message as soon as the SDK has valid partial props. The SDK edits that same message as more tool arguments arrive. User interaction stays disabled until the component props reach a valid interactive state.

## Round 2: Component contract and state

Date: 2026-08-12

1. The component input schema accepts any Standard Schema. A schema from `@copilotkit/schema` may also describe how values become available while JSON streams. Schemas without that streaming contract render only after the full input validates.
2. The component input schema field remains `parameters`. CopilotKit React's `useComponent`, Vue's `useComponent`, `useRenderTool`, and the core frontend-tool contract all use that name.
3. `render` receives one context object with `props`, `state`, `callbacks`, `platform`, and `phase`. The phases are `streaming`, `ready`, and `failed`. Streaming schemas define the partial prop types; the API will not type all partial input as `DeepPartial<T>`.
4. Each tool call creates one durable component instance. `getInitialState()` runs once before the first message posts. Agent-generated props and component state remain separate. The SDK does not expire component instances or their state based on time.
5. Callbacks are stable named async functions. Each callback receives the component props and state, `setState`, the thread, the rendered message, and the interaction event. A callback may start or resume agent work through thread APIs.
6. `setState` accepts a value or updater function. The SDK serializes state updates per component instance, stores the new JSON state, renders the component, edits the same channel message, and resolves after the edit completes.

## Round 3: Streaming lifecycle

Date: 2026-08-12

1. The first message appears when the streaming schema yields its first valid root value. The SDK does not post a placeholder before then. A schema without streaming support waits for final validation.
2. `getInitialState` is optional, pure, synchronous, and context-free. It cannot depend on props, the thread, or network work.
3. The SDK derives a stable component instance ID from the run and AG-UI `toolCallId`. It stores the provider message reference after the first post. Replayed events for the same call resume that instance and do not post another message.
4. Malformed JSON, invalid final props, or an AG-UI run error stops the stream and sets the component phase to `failed`. `render` receives a structured error and the last valid partial props. Callbacks stay disabled.
5. If the component's failure render throws, the SDK replaces the message with a plain platform-safe error.
6. Open: streaming must use a pipeable operator that fits the composition model of `@copilotkit/schema`. It will not copy Hashbrown's `s.streaming.string()`, `s.streaming.object()`, or `s.streaming.array()` constructor hierarchy.

## Round 4: Updates and callback binding

Date: 2026-08-12

1. V0.9 does not add callback queues, provider interaction deduplication, or callback retry guarantees. `setState` calls remain serialized per component instance as decided in Round 2. Broader concurrent-interaction semantics belong to a later API iteration.
2. Stored state remains the source of truth if a Slack or Teams message edit fails. The SDK retries the message edit with backoff and rejects the callback promise with a delivery error. It does not roll back a durable state write.
3. V0.9 has no component deletion API and no automatic component expiration. Deletion and retention policy are outside this version's scope.
4. `render` is synchronous. Async work runs in callbacks, not during rendering.
5. JSX handlers bind a stable callback name plus optional JSON-safe arguments, never a closure. For example, `callbacks.select({ itemId })` creates a handler binding. The SDK stores the callback name and bound arguments, then loads the current component definition, props, and state before it invokes that callback.

## Round 5: Schema operator, limits, and type inference

Date: 2026-08-12

1. `streaming()` is a pipeable `@copilotkit/schema` action used through `schema(base, ...actions)`. It is an identity action during complete-value validation and carries the runtime rules and type information needed for incremental parsing. Developers may attach it to object, array, string, and nested schemas.
2. The design must preserve the streaming semantics already developed in Hashbrown for objects, arrays, strings, completion, partial values, and stable identity. We will study that design in depth before settling those detailed rules.
3. Component state has a 16 KiB limit measured from its UTF-8 encoded JSON. The SDK checks the limit for initial state and every `setState` call.
4. The SDK parses every AG-UI argument delta and calls synchronous `render` when the schema-resolved value changes. Slack and Teams adapters coalesce provider message edits with their built-in rate controls. V0.9 has no public delivery-cadence setting.
5. A callback takes its JSON-safe bound arguments first and SDK context second. The bound-argument type flows into `callbacks.<name>(args)` in JSX. The context types for props, state, `setState`, thread, message, and event also flow from the component definition.
6. The API should infer component, render, callback, binder, props, and state types from `parameters`, `getInitialState`, and `callbacks`. Developers should not need explicit generic arguments for the normal case.
7. Omitting `getInitialState` makes the component stateless. Its `state` is `undefined`, and its callback context does not expose `setState`.

## Round 6: Storage and completion

Date: 2026-08-12

1. A stateful component uses the existing Channels `StateStore`. The in-memory default remains available for local use. The SDK logs one clear warning that in-memory component state and callback recovery do not survive a restart.
2. Stored state may contain JSON nulls, booleans, finite numbers, strings, arrays, plain objects, and missing optional object keys. It may not contain an explicit `undefined`, array holes, `BigInt`, functions, symbols, class instances, cycles, or non-finite numbers. A serialization or 16 KiB error leaves the stored state and rendered message unchanged.
3. A component tool call finishes only after final props validate and the final `ready` render reaches the provider. A parse, validation, render, state, or delivery failure moves the message to `failed` and returns a tool error to the agent.
4. Props freeze when the stream finishes and the component reaches `ready`. Later interactions change state through callbacks. A new agent tool call creates a new component instance.
5. V0.9 does not impose a blanket ban on interaction while a component is streaming. An interaction may become available as soon as the values it needs are valid, even while unrelated values keep streaming. The exact readiness rule awaits the Hashbrown streaming-semantics review.

## Hashbrown streaming baseline

Date: 2026-08-12

The CopilotKit schema design carries these deliberate Hashbrown rules into the pipeable `streaming()` action:

1. A streaming string emits its decoded buffer while the JSON string remains open. It withholds an incomplete escape or Unicode escape until that escape is valid. A normal string waits for its closing quote.
2. A streaming object emits while open. It includes children whose schemas match, omits unmatched children, and may synthesize safe empty values for missing streaming strings, arrays, and objects. A normal object may still resolve before its closing brace once every needed child matches.
3. A streaming array emits while open. It admits an item only when that item's schema matches. An incomplete tail that does not yet match does not change the resolved array or its identity. A normal array waits for its closing bracket.
4. Streaming markers are local. A parent marker controls whether its open container emits; a child marker controls when that child emits. Nested streaming must preserve this distinction.
5. Unchanged nodes, child values, and container branches retain reference identity across chunks. Changed children replace only their ancestor path. This makes render-on-change checks cheap and predictable.
6. Parsing is invariant to chunk boundaries. Syntax errors stop further parsing. Truncated JSON remains usable until finalization and then fails.
7. Partial resolution and final validation stay separate. Final tool execution validates the complete raw arguments against the full schema and every validation rule.

## Round 7: Streaming schema surface

Date: 2026-08-12

1. Developers may apply `streaming()` to string, object, and array schemas, including nested schemas. TypeScript rejects the action on numbers, booleans, literals, and schema kinds that have no defined streaming behavior.
2. Model-facing JSON Schema lists non-streaming object properties before streaming properties. The exported JSON Schema does not contain the streaming marker.
3. The SDK imposes no blanket interaction policy while props stream. Rendered callback bindings are active. Active means that the provider accepts the click; managed callback execution may wait behind the active delivery as settled in Round 16. Callback context is a discriminated union: it carries streaming props during the streaming phase and final props during the ready phase. TypeScript requires developers to narrow or bind the values their callback needs.
4. Open: whether partial resolution runs checks, defaults, or transforms. We will compare designs that run them with designs that defer them.
5. Open: how render code observes node completion without changing the schema's normal output type. We will compare alternatives to Hashbrown's `s.node(...)` output wrapper.

## Round 8: Instance revisions and package delivery

Date: 2026-08-12

1. Every props or state change increments one component-instance revision. Each render uses the latest props and state. Adapters may coalesce edits, but an older revision may not overwrite a newer revision.
2. A callback returns `void` or `Promise<void>`. Return values have no SDK meaning. Callbacks change component state through `setState` and start channel or agent work through thread APIs.
3. The schema library ships as its own public package in an independent CopilotKit release scope, starting at version `0.1.0`. Channels depends on it but does not own its release lifecycle. The source package starts at `0.0.0`; the first minor release PR promotes it to `0.1.0`.
4. The package needs a distinct, memorable name. `@copilotkit/schema` is a working name, not the final name.
5. Channels v0.9 supports progressive components on Slack and Microsoft Teams. Other adapters retain the current final-props component path until they implement progressive message updates.
6. Open: do not persist a second copy of streamed props if the stored AG-UI event stream can rebuild them by tool-call ID. We will verify the current storage and replay path first.

## Round 9: Action checkpoints, readiness, and replay

Date: 2026-08-12

1. `streaming()` is an ordered action checkpoint. While a JSON node remains open, the streaming evaluator runs synchronous actions before that checkpoint in order. A failed check means that no new partial value is ready; it does not fail the stream. Transforms before the checkpoint must be pure, deterministic, and safe to repeat.
2. Defaults, fallbacks, and async actions do not run on partial input. Actions after `streaming()` run during final validation.
3. Node readiness lives beside props instead of changing their value shape. During the streaming phase, render receives schema-derived partial props and a typed `stream.status(...path)` helper. The helper reports `missing`, `partial`, `complete`, or `invalid`. During the ready phase, render receives the plain final output type.
4. The SDK does not persist derived props. It stores the component name, run ID, tool-call ID, last accepted event sequence, provider message reference, state, and revision. It rebuilds props from the ordered AG-UI event ledger. A runtime without a durable event ledger does not promise restart recovery.
5. When a process restart abandons an active run, the SDK replays accepted deltas, rebuilds the last streamed view, and renders it as failed. It does not resume the old agent stream. Completed tool calls rebuild normally.
6. The schema package ships under the working name `@copilotkit/schema`. We may revisit the name later without holding up the API design.

## Round 10: Functional parser and runtime failures

Date: 2026-08-12

1. Incremental parsing is a public `@copilotkit/schema` API. It follows Hashbrown's pure functional model: callers pass parser state into each operation and receive new state back. The API will not expose a mutable parser object, class instance, hidden singleton, or stateful service.
2. The functional surface separates JSON parsing, schema resolution, and finalization so callers can retain and replace immutable parser and resolution-cache state as deltas arrive.
3. Channels defaults each component tool call to 64 KiB of raw UTF-8 JSON, nesting depth 32, and 10,000 parser nodes. Channel-level configuration may lower or raise those limits. Component state keeps its separate fixed 16 KiB cap.
4. V0.9 adopts the new one-object, phase-discriminated render context as a mechanical breaking change. It does not maintain two render contracts.
5. A callback error does not move the component into the tool-stream `failed` phase. The SDK acknowledges the provider interaction, keeps the latest stored state and rendered message, logs a structured error, and shows a short platform-safe error to the user.
6. Deploy-time compatibility for old component instances, removed callbacks, state migrations, and versioned component definitions is outside V0.9 scope.

## Round 11: Parser flow and component execution

Date: 2026-08-12

1. The public streaming parser closely mirrors Hashbrown's layered functional API: create immutable parser state and schema-resolution cache, pass parser state through each chunk, resolve the current schema value with the explicit cache, replace the cache returned by resolution, and finalize the parser state at the end.
2. Streaming resolution returns `match`, `no-match`, or `invalid`. Unchanged parser and schema branches retain reference identity.
3. `setState` does not start agent or channel work. A callback explicitly calls `thread.runAgent()` or `thread.resume()` when it wants that work.
4. Before the first provider post, the SDK creates the component instance, runs and stores initial state, renders the component, and binds and stores its named callbacks. It records the provider message reference after the post. A failed post retries the same pending instance instead of creating another instance.
5. A callback receives an immutable snapshot of the phase, props, and component revision that produced the clicked control. Its bound arguments stay fixed. `setState` combines the new state with the latest available props when it renders, so an interaction cannot overwrite newer streamed content.
6. After the final ready render reaches the provider, the component tool returns `Rendered component "<name>" in the current thread.` It does not put provider message references or component instance IDs into model context.

## Round 12: Bindings, provider delivery, and tool exposure

Date: 2026-08-12

1. `callbacks.<name>(args)` returns an opaque typed binding value, not a function. The binding contains only the callback name and JSON-safe bound arguments. Slack and Teams turn it into a stored provider action ID.
2. The SDK does not split or silently truncate an oversized component. If a prior message exists, it replaces that message with the component's failed render. If the first render exceeds provider limits, it posts one platform-safe error message and fails the tool call.
3. The SDK parses every argument delta and renders only when the schema-resolved value changes. Each adapter serializes and throttles provider edits while keeping only the newest pending revision. A final ready or failed revision flushes in order and may not be skipped.
4. The render context's `platform` field is a discriminant. Developers may branch on it and return Slack or Teams native JSX. A native node for the wrong provider fails the render. Portable Channels JSX works on both.
5. Registration keeps the current agent-tool contract: component `name` is the tool name, `description` is the tool description, and `parameters` exports ordinary model-facing JSON Schema without streaming metadata. Tool-name collisions remain registration errors.

## Round 13: Stream types, status, and errors

Date: 2026-08-12

1. `@copilotkit/schema` exports `InferStream<TSchema>`. It derives the value available at each `streaming()` checkpoint. It is not a blanket `DeepPartial`, and it does not change `InferOutput<TSchema>`.
2. Node status `missing` means that no matching JSON node exists. `partial` means that the node has a usable streamed value but remains open. `complete` means that the JSON node closed and its checkpoint actions passed. `invalid` means that parsing or a terminal check proved that the node cannot produce a valid value.
3. A transient failed check remains `partial` or `missing`; it is not terminally invalid.
4. Zod, Valibot, ArkType, and other Standard Schema values remain valid component parameters. Without `@copilotkit/schema` streaming metadata, the component waits for complete arguments, validates once, and renders ready.
5. Async schemas may define component parameters. Structural streaming stays synchronous. Async checks and transforms run once after JSON finalization and before the ready render.
6. Functional parser errors contain a stable code, message, UTF-16 index, line, and column. Resource-limit errors also include configured and observed limits. Model-generated parse failures return as values instead of throwing.

## Round 14: Update ownership and provider streaming

Date: 2026-08-12

1. An agent cannot update an existing component instance in V0.9. Props freeze after its tool call. Callbacks own state changes. A later agent tool call creates a new component instance.
2. Background jobs and outside code do not receive a component handle in V0.9. State changes enter through named callbacks only.
3. Callback-bound arguments may use at most 16 KiB of JSON-safe UTF-8 data across all bindings in one rendered revision. One binding may use at most 4 KiB. A render that exceeds either limit fails before provider delivery.
4. Slack and Teams each post one normal message, then replace its blocks or Adaptive Card through ordered message edits. V0.9 does not depend on Slack's native append-only streaming API.
5. V0.9 adds no product-level telemetry contract. Existing structured logging covers the failure cases already defined.

## Round 15: Final API and shared outcome

Date: 2026-08-12

1. `defineChannelComponent` uses the agreed `name`, `description`, `parameters`, optional `getInitialState`, named `callbacks`, and synchronous phase-discriminated `render` contract. Normal use requires no explicit component generic arguments.
2. V0.9 excludes deploy migrations, old-message compatibility, component deletion, expiration, external update handles, agent updates to existing instances, callback concurrency guarantees, provider retry deduplication, progressive providers beyond Slack and Teams, edit-cadence settings, and a new telemetry contract.
3. The shared outcome is one progressively rendered Slack message or Teams card per component tool call. Hashbrown-style functional parsing turns valid prefixes into typed props. User actions call stable named callbacks, update durable component state, edit the same message, and may explicitly start agent or channel work.
4. The design-tree frontier is empty. These decisions are the source for `CHANNEL_COMPONENTS_V2.md`.

## Round 16: SDK-only V0.9 cut

Date: 2026-08-12

1. Channels V0.9 requires no Intelligence code, route, database, Gateway, deployment, or configuration change.
2. The SDK stores the latest rendered props in the existing Channels `StateStore` KV record. This supersedes Round 9's decision to rebuild props from the AG-UI event ledger.
3. After the adapter coalescer selects a provider-visible revision, the SDK writes exactly one component snapshot before that create or replace call. Skipped intermediate renders and raw argument deltas cause no snapshot write, and provider retries reuse the persisted revision. A ready snapshot contains the final validated and transformed props.
4. A stored component snapshot contains its format version, component name, phase, JSON-safe props, optional JSON-safe state, revision, and optional structured error. It does not contain a provider message reference. This supersedes the persisted provider-reference parts of Rounds 3 and 11; live code may keep an update-capable reference only in memory.
5. Stored props have a 64 KiB UTF-8 JSON limit. State keeps its 16 KiB limit. Callback binding limits remain 4 KiB per binding and 16 KiB per rendered revision.
6. Each callback binding snapshot keeps the component instance ID, callback name, bound arguments, clicked phase, clicked props, clicked state, and clicked revision. This preserves what the user acted on while the main component snapshot advances.
7. Managed interactions continue through Intelligence's existing same-thread delivery queue. A user may click a control rendered during streaming, but V0.9 does not promise that its callback starts before the active agent delivery finishes.
8. Immediate callback execution during an active managed delivery is outside V0.9 scope. The SDK does not require a new Intelligence side-event or concurrent-delivery contract.
9. Cross-process component ordering beyond Intelligence's existing same-thread delivery queue is outside V0.9 scope. The SDK adds no distributed component lock or compare-and-set contract.
10. V0.9 does not replay AG-UI events to recover component props and does not scan for abandoned streaming instances after restart. If a later interaction loads a streaming snapshot without a live controller, the SDK does not invoke the callback. It stores a failed snapshot and uses the interaction's fresh message reference to replace that same message with the failed view. This supersedes the replay and resume parts of Round 3 item 3 and Round 9 items 4 and 5.
11. Managed Channels stores component snapshots and callback binding records in the existing durable Intelligence KV store without a TTL. Direct Slack or Teams installations use their configured durable store. The in-memory default logs that restart recovery is unavailable.
12. Before the snapshot write and provider call, the SDK rejects props that do not round-trip with the same JSON meaning under the component state JSON rules or exceed 64 KiB. It then moves the component to failed using the last usable in-limit JSON-safe props.
