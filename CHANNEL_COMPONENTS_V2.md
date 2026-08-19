# Channel Components V2

## Problem Statement

Developers can define a Channel component that an agent calls as a tool, but the current Channels SDK waits for the complete tool input before it renders the component. A user sees nothing while the model generates a large Slack Block Kit message or Microsoft Teams Adaptive Card.

The current component contract also has no component-local state or stable named callbacks. Developers must rebuild rendered UI from frozen tool props and recover JSX closures by rendering the old component again. This makes stateful controls, restart recovery, and repeatable message updates harder than they need to be.

Developers need one typed component contract that can:

- render useful props while AG-UI tool arguments stream;
- update one Slack message or Teams card as more props arrive;
- store serializable component state;
- bind durable, typed callbacks to channel controls; and
- let those callbacks update the component or explicitly start agent work.

The streaming behavior must come from a public schema library, not private Channels code. Other CopilotKit surfaces should be able to parse and render the same typed partial values.

## Solution

Release an expanded `defineChannelComponent` contract in Channels SDK V0.9 for Slack and Microsoft Teams. Each definition remains an agent tool with a name, description, and Standard Schema parameter contract.

Publish `@copilotkit/schema` as a separate public package. Add a pipeable `streaming()` action and a pure functional JSON streaming API based on the design proven in Hashbrown. The parser will turn ordered AG-UI argument deltas into schema-derived partial values while retaining reference identity for unchanged branches.

Each component tool call creates one durable component instance. The instance stores the latest rendered props, optional JSON state, a revision, and stable named callback bindings in the existing Channels state store. The SDK renders synchronously when resolved props or state change, then edits the same provider message. A callback may update state or explicitly start agent or channel work through the thread API.

Final tool execution still depends on complete JSON and full schema validation. Partial rendering does not weaken the final tool contract.

## User Stories

### Agent and component author

1. As an agent, I want a component definition exposed as a tool, so that I can render interactive channel UI.
2. As a component author, I want one definition for Slack and Teams, so that I do not maintain two component systems.
3. As a component author, I want platform-specific JSX when I need it, so that I can use native Slack and Teams features.
4. As a component author, I want portable Channels JSX, so that common UI renders on both platforms.
5. As a component author, I want the SDK to infer normal types, so that I do not write component generic arguments.

### Schema author

6. As a schema author, I want `streaming()` to compose with other schema actions, so that streaming follows the library's pipe model.
7. As a schema author, I want streaming rules for strings, objects, arrays, and nested values, so that partial values are predictable.
8. As a schema author, I want `InferStream` separate from final output inference, so that partial rendering does not weaken final types.
9. As a schema author, I want typed node readiness beside the value, so that I can inspect completion without wrapping my data.
10. As a schema author, I want ordinary JSON Schema output, so that models do not see CopilotKit streaming metadata.

### Streaming UI developer

11. As a UI developer, I want the first useful partial value rendered early, so that users see progress while the agent works.
12. As a UI developer, I want all revisions applied to one message, so that streaming does not flood the thread.
13. As a UI developer, I want unchanged value branches to retain identity, so that I can avoid needless renders.
14. As a UI developer, I want node status to distinguish missing, partial, complete, and invalid data, so that I can choose what to show.
15. As a UI developer, I want to render an interaction as soon as its needed values are usable, so that the provider can accept the user's click while other fields stream.

### Channel user

16. As a Slack user, I want blocks to update in place, so that I can follow the component as it forms.
17. As a Teams user, I want an Adaptive Card to update in place, so that I get the same experience as Slack users.
18. As a channel user, I want my interaction to update the same component, so that the result stays in context.
19. As a channel user, I want clear errors when rendering or callbacks fail, so that a broken interaction is not silent.
20. As a channel user, I want one action to run once in the normal path, so that the component behaves predictably.

### Stateful component author

21. As a component author, I want optional initial state, so that I can build stateful or stateless components.
22. As a component author, I want `setState` to accept a value or updater, so that state updates feel familiar.
23. As a component author, I want state stored before the visible edit completes, so that it remains the source of truth after delivery errors.
24. As a component author, I want JSON and size checks before state writes, so that invalid state cannot corrupt an instance.
25. As a component author, I want state to survive process restarts when durable stores exist, so that old controls keep their current state.

### Callback author

26. As a callback author, I want stable named callbacks, so that provider actions do not depend on serialized closures.
27. As a callback author, I want typed bound arguments, so that JSX and callback inputs agree.
28. As a callback author, I want the clicked props revision in my context, so that I know what the user acted on.
29. As a callback author, I want `setState` to render against the newest props, so that my update cannot erase newer streamed content.
30. As a callback author, I want agent work to start only when I request it, so that a state update has no hidden side effect.

### Runtime operator

31. As a runtime operator, I want fixed parser and state limits, so that generated input cannot grow without bounds.
32. As a runtime operator, I want parse failures returned as structured values, so that model errors do not crash the process.
33. As a runtime operator, I want provider edits serialized by revision, so that a slow old edit cannot overwrite a newer one.
34. As a runtime operator, I want the latest provider-visible props stored with the component, so that callback recovery does not replay agent events.
35. As a runtime operator, I want interrupted streaming components to fail when they are next loaded, so that restart behavior is honest without a recovery scan.

### Existing schema user

36. As a Zod user, I want my Standard Schema to keep working, so that streaming components do not force a schema migration.
37. As a Valibot user, I want my Standard Schema to keep working, so that I can render after final validation.
38. As an ArkType user, I want my Standard Schema to keep working, so that I can render after final validation.
39. As an async-schema user, I want async checks and transforms to run after finalization, so that I can keep final validation behavior.
40. As a schema-library user outside Channels, I want the functional parser exported publicly, so that I can build other streaming agent interfaces.

## Implementation Decisions

### Public component contract

- Expand `defineChannelComponent` in place for Channels SDK V0.9. Do not add a parallel V2 function.
- Keep `name`, `description`, and `parameters`. `parameters` matches CopilotKit's other component and tool APIs.
- Add optional `getInitialState`, named `callbacks`, and a synchronous phase-discriminated `render` function.
- Treat the new render context as a mechanical breaking change. Do not maintain both old and new render signatures.
- Infer props, streamed props, state, callback arguments, callback binders, and callback context without explicit component generics in the normal case.

### Render phases

- The render context is a union of `streaming`, `ready`, and `failed` phases.
- The streaming phase contains `InferStream<Parameters>`, typed node readiness, current state, callback binders, platform, and revision.
- The ready phase contains the fully validated and transformed parameter output, current state, callback binders, platform, and revision.
- The failed phase contains the last usable partial props when available, current state, a structured error, platform, and revision. It does not expose callback binders.
- Render is synchronous. Async work belongs in schema finalization or callbacks.

### Schema package

- Publish the schema library as `@copilotkit/schema` V0.1.0 from its own CopilotKit release scope. Keep the source package at V0.0.0 until the first minor release PR promotes it to V0.1.0.
- Keep the package independent from Channels. Channels is its first major streaming consumer.
- Support Standard Schema validation and model-facing JSON Schema export as first-class package contracts.
- Export `InferStream<Schema>` without changing the package's normal final output inference.
- Keep streaming metadata out of exported model-facing JSON Schema.

### Streaming action semantics

- Implement `streaming()` as a pipeable, output-preserving action and an ordered partial-output checkpoint.
- Permit `streaming()` on string, object, and array schemas, including nested schemas. Reject it on schema kinds without defined streaming behavior.
- Run synchronous actions before the checkpoint on each structurally usable partial value. Checks that do not pass withhold a new partial revision instead of failing the stream.
- Require transforms before the checkpoint to be pure, deterministic, bounded, and safe to repeat. Evaluate them from current raw input rather than the prior transformed result.
- Run defaults, fallbacks, async actions, and actions after the checkpoint only during final validation.

### Hashbrown streaming behavior

- A streaming string emits its decoded open buffer and withholds incomplete escape sequences until they become valid.
- A streaming object emits matched children while open, omits unmatched children, and may synthesize safe empty strings, arrays, or objects for compatible streaming children.
- A streaming array emits while open and admits only items whose item schema currently matches. An unmatched tail does not change the prior resolved array.
- Parent and child streaming markers remain local. A parent controls whether its open container emits; a child controls when that child emits.
- Changed children replace only their ancestor path. Unchanged parser nodes, resolved children, and container branches retain reference identity.

### Functional parser API

- Use a pure functional API modeled on Hashbrown. Do not expose mutable parser instances, parser classes, hidden singletons, or stateful parser services.
- Keep immutable JSON parser state and schema-resolution cache explicit. Each operation accepts prior state and returns replacement state.
- Separate chunk parsing, schema resolution, and JSON finalization. Resolution returns `match`, `no-match`, or `invalid` with the next cache.
- Treat syntax and resource errors as structured return values. Include a stable code, message, UTF-16 index, line, and column when applicable.
- Preserve behavior across arbitrary valid chunk boundaries and produce the same final output as one-shot parsing and schema validation.

### Node readiness

- Expose readiness beside props through a typed path helper rather than wrappers, tagged values, or proxies.
- `missing` means that no matching JSON node exists yet. `partial` means that a usable value exists while its node remains open.
- `complete` means that the node closed and its checkpoint actions passed. It does not mean that the whole tool input finished.
- `invalid` means that parsing or a terminal check proved that the node cannot produce a valid value.
- A transient failed checkpoint check withholds the candidate and remains missing or partial rather than terminally invalid.

### Final validation

- Finalize JSON on AG-UI tool-call end, then run the complete parameter schema once over the raw completed value.
- Apply every validation, transform, default, fallback, and async action required by the final schema.
- Treat the final schema output as the only ready props value and freeze it for the component instance.
- Keep third-party Standard Schemas on the final-only path because they do not expose CopilotKit streaming metadata.
- Fail the component tool call when JSON finalization or final schema validation fails.

### Component instance and state

- Create and persist one pending component instance from the AG-UI run and tool-call identity before the first provider post. Duplicate events for the same call and failed-post retries reuse that instance.
- Run `getInitialState` once before the first post. It is optional, pure, synchronous, and independent from props, thread state, and network work.
- Treat a component without `getInitialState` as stateless. Its callbacks do not receive `setState`.
- Store state as JSON without automatic expiry. Reject values that do not round-trip with the same JSON meaning.
- Limit state to 16 KiB of UTF-8 encoded JSON at initialization and on every update.

### JSON state rules

- Permit null, booleans, finite numbers, strings, arrays, plain objects, and missing optional object keys.
- Reject explicit `undefined`, array holes, non-finite numbers, `BigInt`, functions, symbols, class instances, and cycles.
- Within one live SDK process, serialize `setState` calls per component instance and read the latest stored state before each updater. Managed cross-process interactions rely on the existing same-thread delivery queue; V0.9 adds no cross-process component lock.
- Leave state and the rendered message unchanged when serialization or size validation fails.

### State delivery

- Store the new state before provider delivery. Retry a failed edit with backoff, reject `setState` with a delivery error if retries fail, and do not roll back the durable write.
- Resolve `setState` only after the provider edit completes.
- Render the stored state with the latest available props revision rather than the props revision that initiated the callback.

### Callback contract

- Define callbacks as stable named async functions. A callback returns `void` or `Promise<void>`.
- Pass typed JSON-safe bound arguments as the first callback argument and SDK context as the second argument.
- Include the clicked phase, props snapshot, state snapshot, revision, thread, message, and interaction event in callback context. Include `setState` only for stateful components.
- Let callbacks call thread APIs explicitly to run or resume agent work. Neither callback completion nor `setState` starts agent work automatically.
- Do not add callback concurrency, interaction deduplication, or callback retry guarantees in V0.9.
- Do not promise immediate callback execution while an active agent delivery is still running. Managed interactions use the existing same-thread delivery queue.

### Callback bindings

- Make `callbacks.<name>(args)` return an opaque typed binding rather than a closure.
- The opaque render-time binding contains only the callback name and JSON-safe bound arguments. Before provider delivery, the SDK stores a separate binding record with the recovery metadata defined below.
- Limit one binding to 4 KiB and all bindings in one rendered revision to 16 KiB of UTF-8 JSON.
- Capture the phase, props, state, and revision that produced the clicked control. Keep bound arguments fixed.
- Apply `setState` against current stored state and render the result with the newest available props revision.

### Tool-call and event flow

- Register each component as a tool using its name, description, and exported parameter JSON Schema.
- Key active parser state by AG-UI run and tool-call ID. Apply argument deltas in accepted event order.
- Parse each delta, resolve with the current schema cache, and render only when the resolved value changes.
- A control may appear during streaming. The provider may accept a click immediately, but the callback may wait for the active delivery to finish before the existing delivery queue dispatches it.
- Finish the tool only after final JSON and schema validation pass and the ready render reaches the provider.
- Return `Rendered component "<name>" in the current thread.` without adding provider or component identifiers to model context.

### Persistence and recovery

- Store one component-instance snapshot in the existing Channels `StateStore` KV facet without a TTL.
- Store the snapshot format version, component name, phase, latest rendered JSON-safe props, optional state, revision, and optional structured error.
- Do not store a provider message reference. Keep update-capable references in memory during a live stream and use the fresh source-message reference supplied by a later interaction.
- After the adapter coalescer selects the next provider-visible revision, write exactly one component snapshot immediately before that revision's create or replace call. Skipped intermediate render revisions and raw argument deltas cause no component-snapshot write; a provider retry reuses the same persisted revision.
- Store resolved streamed props for a streaming revision and final validated and transformed props for a ready revision.
- Before the snapshot write and provider call, reject props that do not round-trip with the same JSON meaning under the component state JSON rules or whose UTF-8 encoded JSON exceeds 64 KiB. Move the component to failed using the last usable in-limit JSON-safe props.
- Before delivering each rendered revision, store each binding record without a TTL. The record contains component instance ID, callback name, JSON-safe bound arguments, and the rendered phase, props, state, and revision. A later click loads that exact rendered snapshot, while `setState` reads current component state and current stored props.
- When an interaction loads a streaming snapshot without a live component controller, do not invoke the named callback. Write one failed snapshot with an interrupted-stream error, then use the interaction's fresh source-message reference to replace that same message with the failed view. If replacement fails, follow normal provider-error handling. Do not replay AG-UI events, post a second component message, or scan for abandoned instances.
- When the in-memory store is used, log one clear warning that component and callback recovery will not survive a restart.

### Rendering and provider delivery

- Support progressive components on Slack and Microsoft Teams in V0.9.
- Post one normal provider message, then replace its Block Kit blocks or Adaptive Card through ordered edits.
- Parse every delta but use each provider adapter's existing serialized edit throttle. Within one live component controller and delivery, keep only the newest pending revision.
- Within one live component controller and delivery, flush ready and failed terminal revisions in order. Never let an older provider response overwrite a newer component revision.
- Do not use Slack's append-only native streaming API for progressive component replacement.

### JSX and provider limits

- Let portable Channels JSX render on both providers. Let the platform discriminant narrow native Slack and Teams JSX branches.
- Fail a render that returns a native element for the wrong provider.
- Do not split or silently truncate a component that exceeds provider limits.
- Replace an existing message with the component failed view after a limit failure. If no message exists, post one platform-safe error and fail the tool.
- Keep platform budget checks in the adapters so the SDK applies each provider's actual Block Kit or Adaptive Card rules.

### Error behavior

- Move a component to failed after malformed JSON, invalid final props, AG-UI run failure, render failure, parser limit failure, or terminal provider delivery failure.
- Pass structured error data and the last usable partial props to the failed render.
- Fall back to one plain platform-safe error if the component's failed render also throws.
- Acknowledge provider interactions before running callback work. On callback error, keep the latest stored state and rendered view, log the error, and show a short platform-safe error.
- Keep callback failures separate from tool-stream failure; they do not move the full component to the failed phase.

### Limits

| Resource                     |           Default |
| ---------------------------- | ----------------: |
| Raw component tool arguments | 64 KiB UTF-8 JSON |
| Stored component props       | 64 KiB UTF-8 JSON |
| JSON nesting depth           |                32 |
| JSON parser nodes            |            10,000 |
| Component state              | 16 KiB UTF-8 JSON |
| One callback binding         |  4 KiB UTF-8 JSON |
| All bindings in one revision | 16 KiB UTF-8 JSON |

Channels may expose channel-level settings that lower or raise parser argument, depth, and node limits. Stored props, state, and binding limits remain fixed in V0.9.

## Testing Decisions

### Test principles

- Test public behavior and serialized provider output rather than private helper calls.
- Prove that every valid chunk partition produces the same final value as one-shot JSON parsing and final schema validation.
- Assert intermediate streamed values, readiness, and reference identity only where the public contract promises them.
- Cover success, malformed model input, resource limits, render errors, provider errors, callback errors, cold callback recovery from ready snapshots, and lazy interrupted-stream failure.
- Use deterministic clocks and provider fakes for edit throttling. Do not make unit tests wait on real provider timing.

### Schema and parser tests

- Port and adapt Hashbrown's chunk-boundary, escape, Unicode, nested object, nested array, finalization, and stable-identity cases.
- Add broad chunk-split tests that feed the same JSON at every practical character boundary.
- Cover streaming markers on strings, objects, arrays, and nested schemas, plus rejected marker placement.
- Cover checkpoint action order, transient check failure, repeatable transforms, final-only defaults and fallbacks, and async final validation.
- Cover byte, depth, node, malformed-number, malformed-literal, unsafe-key, and incomplete-document errors as returned values.

### Type tests

- Prove `InferStream` for nested objects, arrays, strings, unions, action checkpoints, and final transforms.
- Prove that `InferOutput` stays unchanged when `streaming()` is added.
- Prove phase narrowing for streaming, ready, and failed render contexts.
- Prove callback bound-argument inference and stateful versus stateless callback context.
- Prove that unsupported streaming action placement and async work before a checkpoint fail type checking where possible.

### Channels core tests

- Cover tool registration, same-call instance identity, initial state, first post ordering, ready completion, and tool results.
- Cover multiple interleaved AG-UI tool calls keyed by run and tool-call ID.
- Cover revision fencing so an old render or provider response cannot overwrite a new one.
- Cover callback binding persistence, clicked-revision snapshots, latest-props rerender, state updater serialization, and explicit agent work.
- Cover one KV snapshot per provider-visible revision, streaming and ready props snapshots, JSON safety, the 64 KiB props limit, and request-envelope size.
- Cover cold callback recovery from a ready snapshot, lazy failure for an interrupted streaming snapshot, and the in-memory-store warning.
- Cover existing same-thread delivery queuing so a click accepted during streaming may dispatch after the active delivery ends.

### Provider adapter tests

- Prove Slack posts once and uses ordered message updates for later component revisions.
- Prove Teams posts once and uses ordered activity updates for later component revisions.
- Cover coalescing, terminal flushes, provider update failures, and retry behavior without stale overwrites.
- Cover portable JSX, valid native JSX, cross-provider native JSX errors, and provider budget failures.
- Prove that oversized components are not split or silently truncated.

### Prior art

- Use Hashbrown's functional streaming JSON parser and schema-resolution tests as the semantic baseline.
- Use existing Channels component tests as the baseline for tool registration, final validation, and component-name collision behavior.
- Use existing keyed action recovery tests as the baseline for durable provider action dispatch.
- Use existing Slack and Teams message-stream tests as the baseline for serialized throttled edits.
- Use existing managed Channels restart tests as the baseline for durable state and cold callback recovery.

## Manual Testing Plan

### Slack streaming component

1. Register a component with streamed question text, a streamed option array, state, and a named callback.
2. Ask an agent to render the component in a Slack thread with deliberately slow tool-argument output.
3. Confirm one Slack message appears after the first usable partial props.
4. Confirm that message updates in place as text and options arrive.
5. Confirm the final tool result appears only after the ready message update completes.

### Teams streaming component

1. Register the same logical component with a Teams native render branch.
2. Ask an agent to render it in a Teams thread with slow tool-argument output.
3. Confirm one Adaptive Card appears after the first usable partial props.
4. Confirm the same activity updates as more props arrive.
5. Confirm the ready card uses final validated and transformed props.

### Interaction during streaming

1. Render a control as soon as the schema reports that its required item is usable.
2. Keep an unrelated streamed string or array open.
3. Use the control before the active agent delivery finishes.
4. Confirm Slack or Teams accepts the interaction and the existing same-thread delivery queue waits for the active delivery to finish.
5. Confirm the callback then receives the clicked props revision and fixed bound arguments, while its state update renders with the latest stored props.

### Durable state and recovery

1. Render a stateful component through a durable Channels state store.
2. Use a callback to change state and confirm the provider message updates.
3. Restart the Channels process after the tool call completes.
4. Use the component again and confirm the SDK loads stored final props, state, and callback bindings from KV.
5. Confirm no second component message appears.

### Interrupted stream recovery

1. Start a component tool call and wait for at least one provider render.
2. Stop the Channels process before the tool-call end event.
3. Restart the process and use a control from the interrupted component.
4. Confirm the SDK loads the streaming snapshot from KV and marks it failed because no live controller exists.
5. Confirm the SDK reports that the action is unavailable without replaying AG-UI events or creating a second component message.

### Error and limit behavior

1. Exercise malformed JSON, invalid final schema output, state over 16 KiB, bound arguments over their limits, and provider budget overflow.
2. Confirm model input errors return structured parser or validation failures without crashing the process.
3. Confirm invalid state leaves stored state and the visible message unchanged.
4. Confirm provider budget overflow never splits or silently truncates the component.
5. Confirm a failed-render error falls back to one plain platform-safe message.

### Third-party and async schemas

1. Register final-only components with Zod, Valibot, and ArkType Standard Schemas.
2. Confirm each component waits for full arguments and renders ready after validation.
3. Register a CopilotKit schema with async final validation after a streaming checkpoint.
4. Confirm structural props stream without running the async action per delta.
5. Confirm the component becomes ready only after the async action finishes.

### Callback-started agent work

1. Register a callback that first stores a loading state and then calls a thread agent API.
2. Use the control in Slack and repeat the test in Teams.
3. Confirm `setState` updates only the component and does not start the agent by itself.
4. Confirm the explicit thread call starts the agent work.
5. Confirm callback completion or failure follows the agreed component and user error behavior.

## Out of Scope

- Deploy-time compatibility for component instances created by older component code.
- Component definition versions, state migrations, and removed-callback recovery.
- Component deletion, automatic expiration, retention policy, and cleanup jobs.
- Background-job or outside-code component handles.
- Agent updates to an existing component instance; later agent tool calls create new instances.
- Callback concurrency guarantees, interaction deduplication, and provider retry deduplication.
- Cross-process component ordering beyond the existing managed same-thread delivery queue.
- Immediate callback execution while a managed agent delivery remains active. Managed interactions use the existing same-thread delivery queue.
- Automatic rollback of stored state after provider delivery failure.
- Rebuilding component props from AG-UI event replay.
- Proactive discovery or repair of abandoned streaming component instances after restart.
- Progressive component rendering on providers other than Slack and Microsoft Teams.
- Public provider edit-cadence settings.
- Slack native append-only streaming for component replacement.
- A new product telemetry contract.
- Marketing claims about being the first product to stream Slack Blocks or Teams Adaptive Cards.

## Further Notes

- `@copilotkit/schema` is the working package name. Naming may change later without blocking the API design.
- The schema package must preserve the required copyright and license notices for source brought from the Hashbrown and current CopilotKit schema work.
- The parser should reuse Hashbrown's proven semantics and test cases rather than create a merely similar incremental parser.
- The Channels `StateStore` is the recovery source for component props, state, phase, revision, and callback bindings. Managed Channels already supplies an Intelligence-backed durable store; direct installations must configure a durable store to survive restarts.
- This V0.9 design requires no Intelligence route, database, Gateway, deployment, or configuration change.
- `CHANNEL_COMPONENT_DECISION_LOG.md` is the detailed source for the decisions summarized in this PRD.
