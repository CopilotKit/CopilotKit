# HITL button action envelope

Authoritative wire shape for buttons rendered by `@copilotkit/channels-teams` and
the click Teams delivers back. A consumer that decodes clicks out-of-band (e.g.
the Intelligence managed-Teams ingress, which deep-imports this package's renderer
but runs its own inbound decode) must match this exactly.

Contract test: [`src/button-action-envelope.contract.test.ts`](../src/button-action-envelope.contract.test.ts).
Emitter: `renderButton` in [`src/render/adaptive-card.ts`](../src/render/adaptive-card.ts).
Decoder: `parseCardAction` in [`src/interaction.ts`](../src/interaction.ts).

## Outbound — what the renderer emits

A `<Button>` (with an `onClick` handler, i.e. not a link button) renders as a
**top-level Adaptive Card `Action.Submit`** — deliberately `Action.Submit`, **not
`Action.Execute`** (no `verb`). The opaque action id and optional value ride in
the action's `data`:

```jsonc
{
  "type": "Action.Submit",
  "title": "Approve",
  "data": {
    "ckActionId": "ck:approve", // opaque id; present only when the Button had an onClick handler
    "value": { "decision": "yes" }, // present only when the Button had a `value` prop
  },
  "style": "positive", // optional: "positive" (primary) | "destructive" (danger)
}
```

- A **link** `<Button>` (has a `url` prop) renders as `Action.OpenUrl` instead and
  carries **no** `data` — it is not an interactive submit and never round-trips.
- `data` is omitted entirely if the button has neither an `onClick` id nor a `value`.

## Inbound — what Teams delivers on click

Clicking an `Action.Submit` arrives as a **Message activity** (`activity.type ===
"message"`), NOT an `invoke` / `adaptiveCard/action` / `Action.Execute` activity.
The action's `data` becomes `activity.value`, and the message `text` is empty:

```jsonc
{
  "type": "message",
  "text": "", // empty — the payload is in `value`, not text
  "value": {
    // === the emitted action `data` (merged with any card inputs)
    "ckActionId": "ck:approve",
    "value": { "decision": "yes" },
  },
  "conversation": { "id": "<stable conversation id>" },
}
```

### Decode rules

- **Is it a card action?** `typeof activity.value.ckActionId === "string"`. If not,
  it's an ordinary chat message.
- **Fields:** `id = activity.value.ckActionId`, `value = activity.value.value`.
  Carry only these two — no resume-data smuggling; durability rides on the
  consumer's action store keyed by `id`.
- **Card inputs:** if the card also had `<Input>`/`<Select>` fields, Teams merges
  their values into `activity.value` alongside `ckActionId`/`value`. Read the
  named input keys directly from `activity.value` if needed.
- **Conversation key:** derive it from `activity.conversation.id` (see
  `conversationKeyOf`). Ingress and interaction decode MUST use the same key or the
  waiter is stranded.
