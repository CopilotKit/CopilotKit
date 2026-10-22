# Generative UI example

A generic Google ADK assistant that renders interactive UI from your prompt,
using CopilotKit's standard catalog. Choose the Gemini model, inference format,
and transport in the header. UI can appear in chat or in the `dashboard` and
`notes` page surfaces. The `/catalog` gallery works without an agent or API key.

## Setup

Install Node dependencies from the repository root, then build the packages:

```bash
pnpm install
pnpm nx run-many -t build --projects=@copilotkit/react-core,@copilotkit/runtime
cp examples/v2/a2ui-markdown/.env.example examples/v2/a2ui-markdown/.env.local
```

Set `GOOGLE_API_KEY` in `.env.local` to a Google AI Studio API key. This demo
uses API-key authentication only, with Vertex AI explicitly disabled. No OpenAI
key is needed. Install [uv](https://docs.astral.sh/uv/) and Python 3.12 or 3.13,
then install the locked Python dependencies:

```bash
pnpm nx run @copilotkit/example-a2ui-markdown:install:agent
```

Run these in two terminals from the repository root:

```bash
pnpm nx run @copilotkit/example-a2ui-markdown:dev:agent
pnpm nx run @copilotkit/example-a2ui-markdown:example-dev
```

Open `http://localhost:3011`. The Python server listens on port 8011 and reads
this example's `.env.local`. `ADK_AGENT_URL` can override its base URL in Next.js;
`PORT` overrides the Python server's port.

## Settings

| URL parameter | Choices                                | Default            |
| ------------- | -------------------------------------- | ------------------ |
| `model`       | `gemini-3.6-flash`, `gemini-3.8-flash` | `gemini-3.8-flash` |
| `format`      | `express`, `json`                      | `express`          |
| `transport`   | `markdown`, `tool`                     | `markdown`         |
| `layout`      | `page`, `chat`                         | `page`             |

For example: `/?model=gemini-3.6-flash&format=json&transport=tool`.
All eight model/format/transport combinations use Python ADK. Changing any of
those three settings stops the previous run and starts a fresh conversation,
clearing generated surfaces. The page/chat layout switch keeps the conversation.

Try **Dashboard on the page**, then **Update the dashboard** to exercise an
update across turns. **Sign-up with validation** exercises data bindings,
validation, and a button that sends user-entered values back to the agent.
These are optional user prompts, not an agent-specific flow or system prompt.

## Timing diagnostics

Every run emits `CUSTOM` events named `adk_demo_timing`, visible in the Inspector.
They contain metadata only: IDs, configuration, elapsed milliseconds, model-call
timings, and text-chunk counts. No prompts, generated text, or credentials are
recorded. This is demo instrumentation, not a Google SDK workaround or patch.

Server times use one monotonic clock, starting at entry to the demo agent:

- `run_started_ms`: the adapter emits `RUN_STARTED`.
- `model_calls[].request_ms`: entry to ADK's Gemini model method, before SDK
  preprocessing and network I/O; this is not an HTTP wire timestamp.
- `model_calls[].first_response_ms`: first SDK response, including metadata-only
  or thought chunks. `first_text_ms` excludes thoughts; `first_tool_call_ms`
  tracks tool output separately. Each model invocation gets its own entry.
- `ag_ui_first_text_ms` / `ag_ui_last_text_ms`: text leaving the demo adapter,
  after Express conversion when selected. JSON text passes through directly.

The browser records a separate monotonic clock starting at run initialization.
Open DevTools and inspect `window.adkDemoTimings` (last 20 runs) or filter the
console for `[adk-demo timing]`. Copy a report with
`copy(JSON.stringify(window.adkDemoTimings, null, 2))`.
The report joins server and browser observations by `runId`:

- `browser.run_started_ms`: receipt of `RUN_STARTED`.
- `browser.first_text_ms` / `last_text_ms`: receipt of AG-UI text.
- `browser.first_surface_paint_ms`: first changed surface containing visible
  text or a control/media element in the viewport, checked after two animation
  frames. Empty layouts, styles, and error panels do not count. This is a paint
  opportunity proxy, not a GPU presentation timestamp or proof the whole UI is
  ready. Existing surfaces count only after their DOM changes. Background tabs
  can delay animation frames; use a foreground tab for measurements.
- `browser.finished_ms`: client run finalization. Missing paint means no visible
  content was observed before finalization plus the final paint opportunity.

Subtract timestamps **within the same clock**: model `first_text_ms - request_ms`
measures model/SDK wait; `ag_ui_first_text_ms - model first_text_ms` measures the
adapter/Express delay; browser `first_surface_paint_ms - first_text_ms` measures
the remaining stream/render wait. Do not subtract browser timestamps from server
timestamps. Completion and the first text each produce a server snapshot; run
errors also produce a snapshot. Cancellation cleans up observers and model
streams, but may not deliver a final server event to a disconnected client.

## Formats and streaming

- **JSON** is the existing A2UI v1.0 operation format. “Legacy” refers to the
  inference format, not an older A2UI protocol version.
- **Express** lets the model describe the same components with compact source.
  The Python agent derives its Express instructions from the frontend's catalog
  and compiles the source into A2UI v1.0 JSON using the released A2UI SDK.
  This support is local to the demo; it does not add a public CopilotKit API.
- **Markdown** streams model text. JSON runs use `a2ui` fences. Express runs use
  `a2ui-express target=chat` (or a named page target) fences; the Python adapter
  recompiles valid prefixes into JSON UI updates before the fence closes.
  Incomplete syntax waits for more text. Invalid final output produces an error.
- **Tool** uses genuine Gemini `render_ui` calls: JSON operations in JSON mode,
  or `{target, source}` in Express mode. Python compiles Express arguments and
  preserves the original call ID. With API-key access, tool arguments may be
  buffered until the call is complete; this demo does not enable the ADK
  middleware's Vertex-specific argument-streaming option or simulate tool calls
  from streamed text. Markdown is the progressive-streaming comparison.

The frontend supplies the available components, functions, targets, and current
surface context on each run. The agent has a minimal generic instruction and
uses the ADK middleware's frontend tool bridge. The runtime's existing generative
UI middleware validates and renders tool operations; the existing markdown
renderer handles compiled fences. Inspector surfaces remain inspectable. Its
prompt view shows the frontend/runtime guide, before Python's Express adaptation.

The Express prefix-compilation approach and catalog-generated instructions are
informed by [travel-a2ui](https://github.com/vpm238/travel-a2ui), especially its
[streaming adapter](https://github.com/vpm238/travel-a2ui/blob/main/apps/server/src/travel_a2ui/brain/express.py)
and [generated skills](https://github.com/vpm238/travel-a2ui/tree/main/skills).
The demo uses the current SDK APIs and its own standard catalog, without the
travel domain's flow or prompts.

## Verification

```bash
pnpm nx run @copilotkit/example-a2ui-markdown:test:agent
pnpm nx run @copilotkit/example-a2ui-markdown:check-types
pnpm nx run @copilotkit/example-a2ui-markdown:example-build
```

The Python suite uses controlled model responses and real ADK/compiler code;
it needs no API key. To check provider behavior, run the demo with a real key,
try the same prompt across all eight settings, and compare time to the first UI
update. Include a second-turn surface update and a form submission. Deterministic
tests do not establish live model availability, output quality, or provider-side
streaming behavior.

## Upstream workaround notes

Search the Python source for `WORKAROUND` to find the temporary adaptations.
These observations were reproduced with `a2ui-agent-sdk==0.9.0` and
`a2ui-core==0.4.0`; they are candidates for a Google/A2UI follow-up, not issues
filed by this change.

1. **Express has no incremental parser API.** The released parser reports
   `supports_streaming == False`; `parse_chunk('root = Text(text="Hello")')`
   raises `NotImplementedError`. The demo recompiles accumulated valid prefixes
   and diffs snapshots. Remove this bridge when the SDK can emit incremental
   v1.0 operations. Tests: `test_transport.py` and `test_snapshots.py` cover early
   rendering, split delimiters, operation deduplication, and later updates.
2. **Open-ended function arguments are rejected.** For a function with an
   `expression` property and `additionalProperties: true`, the SDK rejects
   `calc(expression="x+1", x=2)` because `x` is not a declared parameter.
   Instructions teach the equivalent function-value map
   `{"@call":"calc", args:{expression:"x+1", x:2}}`. Remove that instruction when
   Express respects open-ended argument schemas. The compiler tests retain a
   successful map-form example.
3. **Generated guidance forbids named component arguments.** The SDK-generated
   skill recommends positional arguments and says not to output property keys.
   The demo recommends named arguments, particularly for optional styling.
   Content-first ordering now makes short positional calls useful too; it does
   not make long positional signatures easy to count. This is an interoperability
   improvement request for configurable skill generation, not a compiler defect.
   Remove the override when keyword guidance can be requested upstream.

Converting CopilotKit's manifest entries into SDK catalog schemas and choosing
markdown fences instead of SDK sentinel tags are ordinary application
integration. Fixes for repeated deletions, stale snapshot caches, and delimiters
split inside quoted strings are fixes to this demo's adapter, not upstream bugs.

### Standard catalog parameter order

The shared standard catalog defines explicit positional prefixes for all
69 components in `packages/react-core/src/v2/generative-ui/standard/parameter-order.ts`.
`exportA2UICatalog(standardUI)` encodes these in the actual JSON Schema property
order. The browser manifest carries the same `parameterOrder` metadata, which
this demo preserves **after combining props, slots and events** for the SDK.
There is no demo-specific ordering table or catalog-ID special case. For example:

```text
Text("Hello", color="secondary")
Column([heading, body], gap=4)
Button("Save", Event("save"), disabled=false)
TextField("Email", $/email, variant="email")
Chart($/revenue, "month", ["amount"], chartType="line")
```

Content, children, labels/values and common actions lead. Other component-specific
parameters follow; shared layout and typography parameters come last. Use names
for parameters beyond the documented prefix. Requiredness alone is insufficient:
`Text.text`, for example, is optional but still belongs first. The file enumerates
every prefix, including components whose ordering was already suitable.

This is a shared catalog API convention, **not an SDK workaround**. It changes
52 of the 69 standard Express signatures. It preserves property schemas, required
fields, functions, named JSON behavior and React renderers. Custom catalogs can
also declare `parameterOrder`; without it, the adapter retains its existing
props/slots/events order. The browser's catalog owns both field definitions and
the combined Express argument order.

The [official Express proposal](https://a2ui.org/specification/proposals/express/a2ui_express/#schema-driven-key-mapping)
defines positional mapping from JSON property order. The particular component
prefixes are CopilotKit API design, not a list mandated by the specification.
`parameterOrder` is CopilotKit metadata; it is not a portable A2UI schema keyword.

**Compatibility:** old positional Express programs can change meaning. Start a
fresh conversation after changing this policy. Named arguments retain their
meaning. Treat the selected prefixes as a stable calling convention going
forward; review new components explicitly instead of sorting fields implicitly.
Regression tests compare positional calls with named calls, including slots,
actions, bindings and optional primary values. Live comparisons are described in
`agent/benchmarks/README.md`.

### Bridge ordering fix and travel reference audit

`FIX(demo-bridge)` in `agent/src/transport.py` marks a local lifecycle defect:
the SDK can compile a rootless prefix into `updateComponents` and
`updateDataModel` without a `createSurface`. The bridge previously forwarded
these updates to a renderer that correctly rejects unknown surfaces. It now
waits for the create snapshot, which includes the prefix's components and data.
Known surfaces still accept updates immediately. A finished program that only
updates an unknown surface raises an actionable error; a failed batch does not
advance the bridge's bookkeeping. `test_snapshots.py` and `test_transport.py`
cover these cases, deletion/recreation, and one-character markdown chunks.
This fixes our adaptation of the SDK; it is not a Google SDK patch.

The replay also exposed a validation mismatch: an unfinished multiline
`Event("sub` can compile to an event with an empty name. The SDK accepts that
snapshot, but CopilotKit rejects it, including its create operation. The
`FIX(demo-bridge)` in `agent/src/express.py` adds the host's nonempty-name
constraint to event schemas. Partial snapshots wait; a final empty name errors.
`test_express.py` reproduces both. This is host validation we must retain, not
a dependency monkeypatch. The SDK's placeholder behavior is worth including
in upstream feedback about incremental parsing.

The reference was audited at travel-a2ui commit
[`f2ffeda`](https://github.com/vpm238/travel-a2ui/tree/f2ffedac87040699f4e528a47c08dc0250c2e1ea).
Its guidance needs these qualifications when applied here:

- **Prefix compilation is not a complete lifecycle adapter.**
  [`ExpressStream._compile`](https://github.com/vpm238/travel-a2ui/blob/f2ffedac87040699f4e528a47c08dc0250c2e1ea/apps/server/src/travel_a2ui/brain/express.py)
  emits compiled batches into its own application's processing path. Our
  bridge must additionally enforce creation before updates and diff repeated
  snapshots. Assuming every successfully compiled prefix could be forwarded
  directly was our mistake; this audit does not establish a travel-app bug.
- **The positional advice assumes a different catalog order.** Its
  [catalog builder](https://github.com/vpm238/travel-a2ui/blob/f2ffedac87040699f4e528a47c08dc0250c2e1ea/scripts/build_catalog.py)
  explicitly moves semantic properties ahead of shared styling properties and
  documents the failure caused by `weight` becoming the first argument. Its
  [generated skill](https://github.com/vpm238/travel-a2ui/blob/f2ffedac87040699f4e528a47c08dc0250c2e1ea/skills/express-modular/a2ui-travel/SKILL.md)
  places `children` first for `Column`. Our original style-first catalog did not
  satisfy that assumption. The reference already warned about this; we did not
  initially carry its ordering invariant into our integration. The later
  parameter-order policy above addresses that mismatch separately from the
  create-before-update bridge fix. Neither guarantees valid model output.
- **Version and latency assumptions differ.** Its
  [dependency pins](https://github.com/vpm238/travel-a2ui/blob/f2ffedac87040699f4e528a47c08dc0250c2e1ea/apps/server/pyproject.toml)
  are agent-sdk 0.7.0/core 0.2.0; this demo uses 0.9.0/0.4.0. Its generated skill
  declares protocol 0.9.1; this demo emits v1.0. Streaming text alone does not
  guarantee early visible UI: a new surface still needs a compilable root.
  Its comments about cheap prefix compilation are workload-specific, not a
  performance guarantee for our 69-component catalog.

#### Verified renderer differences

The travel React client uses its own
[`SurfaceStore`](https://github.com/vpm238/travel-a2ui/blob/f2ffedac87040699f4e528a47c08dc0250c2e1ea/renderers/react/src/store.ts).
Its `apply` method accepts intermediate states that CopilotKit's
[operation validator](../../../packages/shared/src/generative-ui/validate-operation.ts)
and [surface manager](../../../packages/react-core/src/v2/generative-ui/surface-manager.ts)
reject:

| Incoming operation                    | Travel React store                                                           | CopilotKit renderer                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Update before `createSurface`         | Calls `ensure`, implicitly creating a surface for component or data updates. | Rejects updates to an unknown surface.                                |
| Create containing an empty event name | Stores the component without validating the event name.                      | Rejects the create operation because the event name must be nonempty. |
| Later component revision              | Replaces the component by id, allowing a later snapshot to complete it.      | Applies updates only after the surface has been successfully created. |

Both the implicit creation and acceptance of an empty-event component were
confirmed by calling the travel store directly. This checks store acceptance,
not whether an incomplete button is usable. In CopilotKit, a rejected create
leaves the surface nonexistent, so later updates cannot repair it on their own.
That is why the demo bridge waits for an acceptable create snapshot rather than
forwarding every compiled prefix.

The travel stream adapter validates payloads only when a block finishes; it has
no explicit empty-event-name guard for partial snapshots. Its permissive store
helps explain why that approach cannot be copied unchanged into this demo.
These renderer differences are verified. Whether the older SDK produces the
same empty-name placeholder has not been established; the version difference
alone is not evidence of a compiler regression.

Separately, `ag-ui-adk==0.11.0` documents argument streaming for Gemini through
Vertex AI. This API-key-only demo leaves that option disabled and explains the
resulting tool-mode behavior in the UI. Live Gemini behavior needs verification
with a configured key before making a stronger provider-support claim.
