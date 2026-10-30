# @copilotkit/core

`@copilotkit/core` is the framework-neutral client for CopilotKit runtimes. It
manages runtime agents, frontend tools, shared context, suggestions, thread
stores, and subscriptions.

## Trusted Inspector metadata

When the connected runtime reports `inspectorMetadata: true` in its runtime-info
response, Core loads the optional `InspectorMetadataV1` value in the background.
The runtime connection and agent notifications finish first, so a slow or
unavailable metadata route cannot delay the app.

Core exposes the object returned by Shared normalization unchanged through the
getter and subscriber event. Older runtimes may omit
`usage.expiringSoonCount`; that absence remains valid V1 usage. A value of `0`
means known zero and stays different from absence. Shared omits a malformed
expiry leaf without removing valid `used`, `limit`, or sibling modules. Core
does not calculate or rebuild expiry and does not require a V2 schema.

Read the latest value with `inspectorMetadata`, refresh it without reconnecting,
or subscribe to changes:

```ts
import { CopilotKitCore } from "@copilotkit/core";

const copilotkit = new CopilotKitCore({
  runtimeUrl: "/api/copilotkit",
  headers: { Authorization: "Bearer app-session" },
  credentials: "include",
});

const subscription = copilotkit.subscribe({
  onInspectorMetadataChanged: ({ inspectorMetadata }) => {
    console.log(inspectorMetadata);
  },
});

await copilotkit.refreshInspectorMetadata();
console.log(copilotkit.inspectorMetadata);

subscription.unsubscribe();
```

Core sends the current headers and fetch credentials to the Copilot Runtime. A
call to `setHeaders()` or `setCredentials()` clears the prior value before it
starts a new metadata refresh, so trusted context cannot cross an auth-context
change. Changing the runtime URL or transport, losing the capability, or
disconnecting also clears the value.

Each refresh cancels the prior request and has a five-second deadline. Core also
checks the runtime URL, requested and resolved transport, headers, credentials,
connection, and capability before publishing a response. A stale success or
failure cannot replace metadata from a newer connection. Route, timeout, parse,
and subscriber failures stay isolated from the runtime connection.

See the
[`CopilotKitCore` reference](https://docs.copilotkit.ai/reference/core/classes/CopilotKitCore)
and
[`CopilotKitCoreSubscriber` reference](https://docs.copilotkit.ai/reference/core/types/CopilotKitCoreSubscriber)
for the full API.

## Saved approval decisions

Core retains the latest `CUSTOM` event named `cpki.approval_decisions` per agent
and thread. `getApprovalDecisions(agentId, threadId)` returns a copy of that
projection, `undefined` before one arrives, or `{ error: true }` for invalid data.

The version 1 value is `{ version: 1, decisions: [{ requestId, toolCallId,
approved, status: "waiting" }] }`. Both IDs must be nonempty and unique within
the snapshot. An empty `decisions` array explicitly clears it. A decision records
approval or decline while the native batch waits; it never creates a tool result
or an actionable interrupt. Hosts and importers emit actual results through
`TOOL_CALL_RESULT` and unanswered requests through the standard interrupt outcome.

The React v2 chat renders these decisions read-only, including when connect
replay finishes before the chat mounts. Once its messages contain a canonical
result for the same call, the display says “Result recorded.” Custom message-view
layouts receive this display with `interruptElement`. Other frontend consumers
can use the getter and subscribe to the agent's custom events. This contract is
separate from the graph's `STATE_SNAPSHOT` and does not modify model message context.
