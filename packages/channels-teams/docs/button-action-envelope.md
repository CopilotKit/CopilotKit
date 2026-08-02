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

### The synthesized submit

Adaptive Cards has no per-input submit affordance: an `Input.*` only reaches us
when some `Action.Submit` on the card fires, and `renderButton` is the only other
producer of one. A card that has no submit able to route the click therefore
cannot deliver its inputs anywhere, so `renderAdaptiveCard` appends one bound to
the first handler-bound field:

```jsonc
{
  "type": "Action.Submit",
  "title": "Submit",
  "data": {
    "ckActionId": "ck:note", // the field's minted handler id — what gets dispatched
    "ckValueField": "reason", // the card `id` of the field whose text IS the action value
  },
}
```

The two differ whenever an explicit `<Input name>` (or a collision suffix) renames
the field, so both are carried.

It is appended only when the card has **no dispatchable submit** — an
`Action.Submit` carrying a `ckActionId`. Having _some_ action is not enough: an
`Action.OpenUrl` (a link `<Button>`) opens a URL and submits nothing, and a
`<Button>` with no `onClick` submits but routes nowhere, so an `<Input>` beside
either still needs one.

**One submit per card.** Adaptive Cards fires a single action, so only the first
handler-bound field is bound; later `<Input onSubmit>` handlers never fire. Their
text is _not_ lost — Teams merges every input into this one submit, so all of them
arrive as submitted fields. Read them from `activity.value` (or
`InteractionEvent.values`) rather than expecting a per-input handler.

A field dropped by the body-element budget is skipped, since a submit with no
visible input above it would dispatch `undefined` to a `ClickHandler<string>`.

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
- **Fields:** `id = activity.value.ckActionId`. No resume-data smuggling —
  durability rides on the consumer's action store keyed by `id`.
- **Card inputs:** if the card also had `<Input>`/`<Select>` fields, Teams merges
  their values into `activity.value` alongside the envelope keys. Every key that
  is **not** `ckActionId` / `value` / `ckValueField` is a submitted field; those
  three names are reserved and are never minted as field ids.
- **Action value:** `activity.value[ckValueField]` when `ckValueField` is set and
  names a present field (the synthesized input submit — the dispatched handler is
  an `<Input onSubmit>`, whose contract is the typed text), else
  `activity.value.value` (the clicked button's own value).
- **Typed text is a string.** Teams delivers `Input.Text` values as strings and
  nothing may coerce them: `42`, `true`, `null` and `{"a":1}` must reach the
  handler as those four strings.
- **Conversation key:** derive it from `activity.conversation.id` (see
  `conversationKeyOf`). Ingress and interaction decode MUST use the same key or the
  waiter is stranded.
