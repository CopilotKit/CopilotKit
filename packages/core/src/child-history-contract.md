# Child history presentation contract

This internal compatibility contract is consumed by `ɵChildHistoryStore`.
It is presentation data: it never appends imported messages to model input or
executes saved tool calls. The native Claude emitter currently lives outside
this repository. Tests in `__tests__/child-history.test.ts` exercise recorded
wire shapes through the actual AG-UI subscriber pipeline; they are not a live
emitter conformance test.

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
When a delegation is missing, the store retains the root user turn observed on
first arrival. Without any root-turn evidence, the view uses the first retained
turn as a fallback rather than moving the child below each new turn.
