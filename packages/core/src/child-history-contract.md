# Child history presentation contract

This internal compatibility contract is consumed by `ɵChildHistoryStore`.
It is presentation data: it never appends imported messages to model input or
executes saved tool calls. Snapshots come from the Intelligence import loader;
live events come from `@ag-ui/claude-agent-sdk`. Both live outside this
repository. `__tests__/child-history-claude-conformance.test.ts` replays events
recorded from the published emitter (`@ag-ui/claude-agent-sdk@0.0.8`, driven by
a scripted SDK stream) through the AG-UI subscriber pipeline. That release does
not emit child interrupts; their shape below matches ag-ui `main` at
`44f4e02e3c` (`native-recovery.ts`) and is covered by recorded-shape tests in
`__tests__/child-history.test.ts`.

## Snapshot events

`CUSTOM`, name `cpki.child_histories`, accepts:

- Version 1: `{ version: 1, histories: History[] }`, an atomic replacement.
- Version 2: `{ version: 2, historyIndex, historyCount, chunkIndex, chunkCount,
data }`. Each history is JSON split into strings of at most 16,384 UTF-16
  code units. Indices start at zero and arrive in order. Counts stay constant
  within a snapshot/history. The receiver caps assembled UTF-8 data at 32 MiB.
  Identical immediately repeated chunks are ignored. Partial or malformed
  snapshots never replace the last valid tree. Unknown versions are ignored.

A History has a nonempty `namespace: string[]` (maximum depth 32), optional
`name`, optional `parentToolCallIds: string[]`, and `runs`. Each run has
`sourceRunId` and `messages`. Namespaces are unique and nested histories must
include their parent. Parent call IDs establish ownership; ambiguous ownership
must never copy a result across siblings.

Messages have nullable `sourceMessageId`, `role` (user, assistant, tool, system,
developer), optional `toolCallId` and `error`, and ordered `content` blocks:

- `{ type: "text" | "reasoning", text }`
- `{ type: "tool_call", id, name, args }` (`args` is a JSON value)
- `{ type: "media", modality?, mimeType?, filename?, source?, dataBase64?,
unresolvedRef? }`; source is `{ type: "url" | "file", value, mimeType?,
provider? }`. Source MIME takes precedence over block MIME. Snapshot URLs
  permit HTTP(S); inline bytes use `dataBase64`. Opaque files stay opaque.

Repeated identical assistant records are deduplicated. Distinct assistant
fragments sharing a source ID combine their text, media and calls in order.
Tool results sharing a source ID retain separate call identities. Null message
IDs derive from the run ID and record index.

## Live compatibility boundary

`child-history-claude-adapter.ts` translates legacy native details before the
framework-neutral store consumes them:

- `claude:assistant_content` → `cpki.child_assistant_content`. Value fields are
  `parentToolUseId`, `messageId`, optional record `uuid`, and normalized content.
  Text/thinking/tool_use become text/reasoning/tool_call, and the legacy
  `mcp__ag_ui__` tool prefix is stripped. Distinct UUID records accumulate;
  repeated UUID records replace themselves.
- Interrupt metadata source `claude-sdk-native-child` → `cpki.child`, retaining
  `childId`, `parentToolUseId`, `toolName`, `input`. Both ownership IDs must be
  nonempty. Root interrupts do not synthesize child regions.
- Tool result `rawEvent.parent_tool_use_id` / `is_error` → internal
  `childHistory.parentToolCallId` / `isError`.

A producer can emit the neutral shapes directly. The legacy adapter remains so
existing deployments can replay persisted native events without a migration.

## Placement

A child renders after the root assistant message that delegated to it. When
that call is missing from root messages, a child created by a live interrupt
keeps the root user turn it arrived in; replay preserves event order, so the
turn survives reload. Snapshot arrival is not placement evidence: an import
carries no turn, and the import loader persists snapshots after the first
`RUN_STARTED` regardless of when a child ran. A child with no evidence renders
after the first root turn and is labelled "Original position not recorded".
Placement is decided once and never moves to a later turn.

## Retention and reset

Direct `agent.setMessages([])` clears the current thread's child store. AG-UI
replay message snapshots carry run input and do not trigger this reset. Chat
thread switches release the discarded thread. Headless consumers retain at
most four recently updated threads per agent; older threads must replay when
reopened. Live overlays remain available within retained threads so an older
snapshot cannot silently erase a just-completed call; this data is the child
transcript itself, so it grows with the thread like root messages do. A
streamed record merges into its owning child only, and records no history owns
are kept without notifying listeners.
