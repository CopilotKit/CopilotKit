# HITL button action envelope

Authoritative wire shape for the Adaptive Card actions `@copilotkit/channels-teams`
emits and the click Teams delivers back. A consumer that decodes clicks out-of-band
(e.g. the Intelligence managed-Teams ingress, which deep-imports this package's
renderer but runs its own inbound decode) must match this exactly.

Contract test: [`src/button-action-envelope.contract.test.ts`](../src/button-action-envelope.contract.test.ts).
Emitters (both in [`src/render/adaptive-card.ts`](../src/render/adaptive-card.ts)):
`renderButton` for a `<Button>`, `synthesizeSubmit` for the submit the renderer
adds to a card that has none it can dispatch.
Decoder: `parseCardAction` in [`src/interaction.ts`](../src/interaction.ts).

## Outbound — what the renderer emits

A **non-link** `<Button>` — one with no `url` prop — renders as a **top-level
Adaptive Card `Action.Submit`**, deliberately `Action.Submit` and **not
`Action.Execute`** (no `verb`). Whether it carries an `onClick` handler decides
what goes in `data`, not which action type is emitted. The opaque action id and
optional value ride in the action's `data`:

```jsonc
{
  "type": "Action.Submit",
  "title": "Approve", // the button's text, truncated to TEAMS_LIMITS.buttonText
  "data": {
    "ckActionId": "ck:approve", // opaque id; present only when the Button had an onClick handler
    "value": { "decision": "yes" }, // present only when the Button had a `value` prop
  },
  "style": "positive", // optional: "positive" (style="primary") | "destructive" (style="danger" | "destructive")
}
```

- A **link** `<Button>` (a non-empty `url` prop) renders as `Action.OpenUrl`
  instead and carries **no** `data` — it is not a submit and never round-trips.
- `data` is omitted entirely if the button has neither an `onClick` id nor a
  `value`. Such an `Action.Submit` still renders and still posts an activity, but
  with no `ckActionId` the decoder rejects it as not-a-card-action.
- `renderButton` never emits `ckValueField`. That key belongs solely to the
  synthesized submit below.

### The synthesized submit

Adaptive Cards has no per-input submit affordance: an `Input.*` only reaches us
when some `Action.Submit` on the card fires, and `renderButton` is the only other
producer of one. A card with no submit able to route the click therefore cannot
deliver its inputs anywhere, so `renderAdaptiveCard` adds one (`synthesizeSubmit`)
bound to a handler-bound field:

```jsonc
{
  "type": "Action.Submit",
  "title": "Submit", // always this literal
  "data": {
    "ckActionId": "ck:note", // the field's minted handler id — what gets dispatched
    "ckValueField": "reason", // the card `id` of the field whose submitted value IS the action value
  },
}
```

A synthesized submit never carries a `value` key: its action value comes from
`ckValueField` instead. The two ids differ whenever an explicit `name` prop (or a
collision-dedupe suffix) renames the field, so both are carried.

**When it is added.** Only when the card has **no dispatchable submit** — an
`Action.Submit` whose `data.ckActionId` is a string. Having _some_ action is not
enough: an `Action.OpenUrl` (a link `<Button>`) opens a URL and submits nothing,
and a `<Button>` with no `onClick` submits but routes nowhere, so a field beside
either still needs one.

**Which field it binds.** The _first_ field, in render order, that both (a) had a
minted handler — `<Input onSubmit>` **or** `<Select onSelect>`; a field with
neither is never a candidate — and (b) survived the `TEAMS_LIMITS.bodyElements`
clamp. A field the body clamp dropped is skipped as a candidate, because a Submit
with no visible input above it would dispatch `undefined` to a
`ClickHandler<string>`. If no candidate survives, **nothing is synthesized** and
the card can end up with no actions at all.

**One submit per card.** Adaptive Cards fires a single action, so only that first
field is bound; later `<Input onSubmit>` / `<Select onSelect>` handlers never
fire. Their values are _not_ lost — Teams merges every input into this one submit,
so all of them arrive as submitted fields. Read them from `activity.value` (or
`InteractionEvent.values`) rather than expecting a per-field handler.

**Action budget.** Top-level actions are clamped to `TEAMS_LIMITS.actions` (6),
and the synthesized submit's slot is reserved _inside_ that ceiling: the authored
actions are clamped to `actions - 1` and the submit is then appended. So a card
never emits more than the ceiling, the submit — the card's only route back into
the engine — is never the entry the clamp drops, and it is always **last** in
`actions`.

**Overflow does not create one.** Whether to synthesize is decided against the
_unclamped_ action list. A dispatchable `<Button>` that the action clamp then
drops still suppresses synthesis: the author bound that handler, and dispatching
a field's handler in its place would be a wrong dispatch, which is worse than
none. Such a card is emitted with no route back into the engine.

**`<Select multi>` caveat.** `renderSelect` emits `isMultiSelect: true` and Teams
submits the chosen values as a **comma-joined string**. Nothing on this path
splits it, so a `<Select multi onSelect>` handler receives that single string, not
the `string[]` that `SelectProps.onSelect` (`ClickHandler<string | string[]>`)
advertises. This is a pre-existing Teams fidelity gap; the synthesized submit only
makes it reachable.

## Inbound — what Teams delivers on click

Clicking an `Action.Submit` arrives as a **Message activity** (`activity.type ===
"message"`), NOT an `invoke` / `adaptiveCard/action` / `Action.Execute` activity.
The action's `data` becomes `activity.value`; the click carries no user text and
the adapter never reads `activity.text` on this path:

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

- **Is it a card action?** `activity.value` is a non-null object _and_
  `typeof activity.value.ckActionId === "string"`. If not, it is an ordinary chat
  message and `parseCardAction` returns `undefined`.
- **Id:** `id = activity.value.ckActionId`. No resume-data smuggling — durability
  rides on the consumer's action store keyed by `id`.
- **Card inputs:** if the card also had `<Input>`/`<Select>` fields, Teams merges
  their values into `activity.value` alongside the envelope keys. Every key that
  is **not** `ckActionId` / `value` / `ckValueField` is a submitted field. Those
  three names are reserved (`CARD_ENVELOPE_KEYS`): the renderer seeds its used-id
  set with them and ignores an explicit `name` that matches one, so no field is
  ever minted under them.
- **Action value:** `activity.value[ckValueField]` when `ckValueField` is a string
  **and** that key is present among the submitted fields. That is the synthesized
  submit: the dispatched handler is an `<Input onSubmit>` or `<Select onSelect>`,
  whose contract is the submitted value, not a (nonexistent) button value.
  Otherwise the action value is `activity.value.value` — the clicked button's own
  value.
- **`ckValueField` miss.** The `else` above is also the miss fallback: if
  `ckValueField` names a field absent from the payload, the decode neither throws
  nor surfaces the raw envelope — it silently yields `activity.value.value`, which
  on a synthesized submit is `undefined`, so a `ClickHandler<string>` receives
  `undefined`. A `ckValueField` naming a reserved key misses for the same reason
  (reserved keys are stripped before the lookup), though the renderer never emits
  one.
- **Typed text is a string.** Teams delivers `Input.Text` values as strings and
  nothing may coerce them: `42`, `true`, `null` and `{"a":1}` must reach the
  handler as those four strings.
- **`values` carries only submitted data.** `parseCardAction` builds it with a
  null prototype, because `__proto__` survives `JSON.parse` as an own key: an
  out-of-band decoder that copies fields onto a plain `{}` runs
  `Object.prototype`'s setter instead, and the handler then sees an invisible
  inherited property in place of the submitted value. Build the field map with
  `Object.create(null)`.
- **Conversation key:** derive it from `activity.conversation.id` (see
  `conversationKeyOf`). Ingress and interaction decode MUST use the same key or
  the waiter is stranded.
