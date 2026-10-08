# Native persistence (row 2)

Row 2 reads a framework's durable native storage independently of Intelligence.
It preserves full native envelopes and sidecars, then compares captured input and
emitted output against explicitly selected native fields. The shared category
catalog includes all seven implementations, four media discriminators and three
source variants, generated UI, tools/MCP, shared state, and separate pending and
completed frontend/native interactions. Missing applicable coverage is unvalidated.

## Run

Use the common runner (provided by PNI-596):

```sh
pnpm nx run intelligence-smoke:rich-threads -- \
  --framework=mastra --rows=2 \
  --fixture=/absolute/path/to/bootstrap.mjs \
  --baseline=/absolute/path/to/baseline.json \
  --output=/absolute/new/output-directory
```

A non-passing report returns a nonzero exit code. A missing inspection service is
blocked; malformed evidence fails. Each native capture, its comparisons, and the
per-category verdict are retained. The runner validates the source/package baseline.

The fixture exports `createFixture` and supplies:

- `services.row2.captureFresh({ fixture })`: run genuinely fresh conversations,
  inspect the non-memory store before and after, and return captures.
- `fixture.row2.coverage[category].required`: required observation names. Cover
  every occurrence, including call/result pairing and order; do not reduce calls
  to a set or discard repeats. A source limitation or N/A needs both a reason and
  evidence and cannot conceal a failed observation.
- `cleanup()`: release only resources owned by this fixture.

Each capture has `identity.threadId`, `provenance.input`, `provenance.events`,
`provenance.fixture`, an absent `before.records`, a durable `after` snapshot, and
`observations`. A snapshot is `{ kind, location, records }`; supported kinds are
`sqlite`, `file`, and `postgres`. PostgreSQL inspection is supplied by the bootstrap;
the included readers implement explicit read-only SQLite queries and JSON files.
Neither reader reconstructs a record from Intelligence history.

An observation selects `record` and a JSON `pointer`, with an independently captured
`expected` value. `pointers` selects an ordered list, useful for role order and call
occurrence checks. Every observation names its `category` and `source` artifact/pointer.
For media, select the complete containing message envelope and provide `media.bytes`
(pointer and `base64`, `data-uri`, or `byte-array` encoding), `mimePointer` when needed,
`filenamePointer`, and expected SHA-256, length, MIME and filename. `mimeEncoding: format`
handles native PNG/JPEG/PDF/WAV/MP4 format discriminators. Filename sidecars must be
associated with the same native content index; finding a name elsewhere is insufficient.

For pending native controls, compare the full checkpoint task/interrupt identity,
payload and suspension state, not only a tool-call message. Completed controls need
the submitted response, native result, cleared pending metadata and final assistant
response. Runtime-only MCP resources require explicit source-limit evidence; never
reexecute historical tools to manufacture missing native content.

## Local adapter controls

`local-fixture.mjs` exercises real Mastra/Strands adapters against AIMock and new
owned stores. Set `PNI597_DEPS_CONFIG` to a JSON file with `mastra` and
`strands-typescript` dependency-project directories, `aimockEntry`, `mediaDirectory`,
and optionally a local `port`. Media files are `cedar-image.png`,
`cedar-document.pdf`, `cedar-audio.wav`, and `cedar-video.mp4`. This fixture does not
install dependencies or obtain credentials. It records resolved dependency entries
and SHA-256s; equal npm versions do not imply equal local builds. Strands SDK classes
are loaded from the adapter's own dependency graph to preserve lifecycle-hook identity.

The current local controls cover fresh text/order, inline media, frontend approvals,
Mastra native requireApproval, and Strands native interrupts, with separate pending
and completed sessions. Mastra uses both message-memory and workflow storage; Strands
inspects `pendingToolExecution.assistantMessageData` as well as ordinary messages.
Mastra SQLite JSONB workflow snapshots are decoded with `json(snapshot)`.

These controls use the adapter API with synthetic model responses. They do not
certify visible application/Intelligence-connected operation, rich chart/GenUI/MCP
or meaningful shared-state scenarios, reasoning, parallel surfaces, URL/provider-file
media, other five implementations, import or restart durability. Those categories
remain unvalidated and must be supplied by the broader fixture bootstrap. A model
serialization error after a native media save is retained separately from storage
comparison failures. Native-source omissions and middleware-only resources must be
attributed explicitly in the validation report.

## Verification

```sh
pnpm nx run intelligence-smoke:test
pnpm nx run intelligence-smoke:lint
```

The negative controls exercise changed order, tool arguments, interrupt identities,
missing task metadata, media MIME/bytes/filename mismatches, hidden pending native
calls, non-durable/reused stores, missing coverage and read-only-store boundaries.
Do not update the project matrix or claim released support from these local runs.
