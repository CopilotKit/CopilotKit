import { describe, it, expect } from "vitest";
import {
  decodeInteraction,
  conversationKeyOf,
  decodeViewSubmission,
} from "./interaction.js";
import { renderBlockKit } from "./render/block-kit.js";
import { DM_SCOPE } from "./types.js";

/**
 * The `state.values` Slack posts back for a rendered message's text inputs:
 * block id → element `action_id` → the element's reading. Built from the real
 * blocks so the renderer's own keying is what the decoder is handed.
 */
function textInputState(
  blocks: unknown[],
  typed: string[],
): Record<string, Record<string, unknown>> {
  const inputs = blocks.filter(
    (b) =>
      (b as { element?: { type?: string } }).element?.type ===
      "plain_text_input",
  ) as { block_id: string; element: { action_id: string } }[];
  expect(inputs).toHaveLength(typed.length);
  return Object.fromEntries(
    inputs.map((b, i) => [
      b.block_id,
      { [b.element.action_id]: { type: "plain_text_input", value: typed[i] } },
    ]),
  );
}

describe("conversationKeyOf", () => {
  it("joins channelId + scope with the canonical separator", () => {
    expect(conversationKeyOf({ channelId: "C1", scope: "100.0" })).toBe(
      "C1::100.0",
    );
    expect(conversationKeyOf({ channelId: "D9", scope: DM_SCOPE })).toBe(
      "D9::dm",
    );
  });
});

describe("decodeInteraction", () => {
  it("extracts the opaque action_id + tiny value from a thread block_actions", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      user: { id: "U1", name: "Ana" },
      channel: { id: "C1" },
      message: { ts: "111.1", thread_ts: "100.0" },
      actions: [{ action_id: "ck:abc", value: '{"confirmed":true}' }],
    });
    expect(evt).toBeDefined();
    expect(evt!.id).toBe("ck:abc");
    expect(evt!.value).toEqual({ confirmed: true });
    expect(evt!.conversationKey).toBe("C1::100.0");
    expect(evt!.replyTarget).toEqual({ channel: "C1", threadTs: "100.0" });
    expect(evt!.actor).toEqual({ id: "U1", kind: "human", name: "Ana" });
    expect(evt!.messageRef).toEqual({ id: "111.1", channel: "C1" });
  });

  it("uses DM_SCOPE and a flat replyTarget for DM channels", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      user: { id: "U2", username: "bob" },
      channel: { id: "D5" },
      message: { ts: "9.9" },
      actions: [{ action_id: "ck:dm", value: "yes" }],
    });
    expect(evt!.conversationKey).toBe("D5::dm");
    expect(evt!.replyTarget).toEqual({ channel: "D5", threadTs: undefined });
    expect(evt!.value).toBe("yes");
    expect(evt!.actor).toEqual({ id: "U2", kind: "human", name: "bob" });
  });

  it("scopes a THREADED DM (assistant pane) by its thread ts, not DM_SCOPE", () => {
    // Regression: an assistant-pane DM is threaded, so the ingress path keys
    // the turn by thread ts. Forcing DM_SCOPE here stranded the HITL waiter and
    // the run never resumed after a Create/Cancel click.
    const evt = decodeInteraction({
      type: "block_actions",
      user: { id: "U3", name: "Cara" },
      channel: { id: "D7" },
      message: { ts: "300.1", thread_ts: "300.0" },
      actions: [{ action_id: "ck:hitl", value: '{"confirmed":true}' }],
    });
    expect(evt!.conversationKey).toBe("D7::300.0");
    // Replies should go back into the assistant thread.
    expect(evt!.replyTarget).toEqual({ channel: "D7", threadTs: "300.0" });
    expect(evt!.value).toEqual({ confirmed: true });
  });

  it("falls back to container fields when message/channel are absent", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C3", thread_ts: "200.0" },
      actions: [{ action_id: "ck:c", selected_option: { value: "opt-1" } }],
    });
    expect(evt!.conversationKey).toBe("C3::200.0");
    expect(evt!.value).toBe("opt-1");
    expect(evt!.actor).toEqual({ id: "unknown", kind: "unknown" });
  });

  it("decodes a multi_static_select's selected_options into a string[] value", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C3", thread_ts: "200.0" },
      actions: [
        {
          action_id: "ck:ms",
          selected_options: [{ value: "core" }, { value: "infra" }],
        },
      ],
    });
    expect(evt!.value).toEqual(["core", "infra"]);
  });

  it("keeps a plain_text_input's typed text as a string, never JSON-parsed", () => {
    // `<Input onSubmit>` is a `ClickHandler<string>`. Parsing free text would
    // silently hand the handler a number/boolean/null/object instead.
    for (const typed of ["42", "true", "null", '{"a":1}', "ship it"]) {
      const evt = decodeInteraction({
        type: "block_actions",
        container: { channel_id: "C1", thread_ts: "200.0" },
        actions: [
          { action_id: "ck:note", type: "plain_text_input", value: typed },
        ],
      });
      expect(evt!.value).toBe(typed);
    }
  });

  it('delivers an EMPTY plain_text_input as "", in `value` and in `values` alike', () => {
    // Slack reports a genuinely empty text input as `value: null`. Passing that
    // through breaks the `ClickHandler<string>` contract, and it disagrees with
    // Teams, where the same JSX arrives as `""` (Teams merges an untouched
    // `Input.Text` into the submit that way — see its `render/adaptive-card.ts`
    // and `input-submit.e2e.test.ts`). Empty is `""` on both surfaces.
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [
        { action_id: "ck:note", type: "plain_text_input", value: null },
      ],
      state: {
        values: {
          "ckf:note": { "ck:note": { type: "plain_text_input", value: null } },
        },
      },
    });
    expect(evt!.value).toBe("");
    expect(evt!.values!.note).toBe("");
  });

  it('reports an untouched <Input> beside a clicked <Button> as "" in `values`', () => {
    // The non-dispatching half of the same contract, and the exact shape Teams
    // asserts: one field filled in, one left blank, submitted together. Slack
    // still lists the blank one — as `null` — so `values` must report `""` for
    // it, not `null` and not a missing key.
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:approve", type: "button", value: '"yes"' }],
      state: {
        values: {
          "ckf:why": {
            "ck:why": { type: "plain_text_input", value: "ship it" },
          },
          "ckf:details": {
            "ck:details": { type: "plain_text_input", value: null },
          },
        },
      },
    });
    expect(evt!.values).toEqual({ why: "ship it", details: "" });
  });

  it("still JSON-parses a button value (a payload we serialized ourselves)", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:b", type: "button", value: "42" }],
    });
    expect(evt!.value).toBe(42);
  });

  it("falls back to the element's action_id for a block the renderer didn't name", () => {
    // So a <Button onClick> handler beside an <Input> can read what was typed.
    // These block ids carry no `ckf:` field id (a <Raw> block, or a message
    // rendered before that vocabulary existed), so the element's own action_id
    // is the only stable key left.
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:approve", type: "button", value: '"yes"' }],
      state: {
        values: {
          block1: {
            "ck:note": { type: "plain_text_input", value: "42" },
          },
          block2: {
            "ck:team": {
              type: "static_select",
              selected_option: { value: "core" },
            },
            "ck:owners": {
              type: "multi_static_select",
              selected_options: [{ value: "ada" }, { value: "bo" }],
            },
          },
        },
      },
    });
    expect(evt!.value).toBe("yes");
    expect(evt!.values).toEqual({
      // Still a string: typed text is never coerced, here or in `value`.
      "ck:note": "42",
      "ck:team": "core",
      "ck:owners": ["ada", "bo"],
    });
  });

  it("resolves the same <Select> identically in `value` and in `values`, as the string Slack carried", () => {
    // A `SelectOption.value` is a `string` and block-kit writes it to the wire
    // verbatim — no JSON — so neither accessor may JSON-parse it back: "42"
    // must stay "42", not become the number 42. The two must also agree, or one
    // control would reach a handler as `42` via ctx.action.value and "42" via
    // ctx.values. ("007" is the only one that survived parsing, by luck: it
    // isn't valid JSON.)
    for (const chosen of ["42", "true", "null", "007", "core"]) {
      const evt = decodeInteraction({
        type: "block_actions",
        container: { channel_id: "C1", thread_ts: "200.0" },
        actions: [
          {
            action_id: "ck:sel",
            type: "static_select",
            selected_option: { value: chosen },
          },
        ],
        state: {
          values: {
            block1: {
              "ck:sel": {
                type: "static_select",
                selected_option: { value: chosen },
              },
            },
          },
        },
      });
      expect(evt!.value).toBe(chosen);
      expect(evt!.values!["ck:sel"]).toBe(chosen);
    }
  });

  it("resolves a multi <Select> identically in `value` and in `values`, as the strings Slack carried", () => {
    // Same contract for `selected_options`: `<Select multi onSelect>` is a
    // `ClickHandler<string[]>`, so every element stays the string on the wire.
    const chosen = ["42", "true", "null", "007"];
    const selected_options = chosen.map((value) => ({ value }));
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [
        {
          action_id: "ck:multi",
          type: "multi_static_select",
          selected_options,
        },
      ],
      state: {
        values: {
          block1: {
            "ck:multi": { type: "multi_static_select", selected_options },
          },
        },
      },
    });
    expect(evt!.value).toEqual(chosen);
    expect(evt!.values!["ck:multi"]).toEqual(chosen);
  });

  it('reports an untouched single <Select> beside a clicked <Button> as ""', () => {
    // The select half of the same "empty is a reading, not absence" contract
    // the blank `<Input>` case above pins. Slack lists an untouched single
    // select as `selected_option: null` — a control that IS on the message and
    // holds no choice — so `values` owes `""`, the string `onSelect`'s
    // `ClickHandler<string | string[]>` declares, not `null` and not
    // `undefined`. It is also what identical JSX delivers on Teams, which
    // merges an untouched `Input.ChoiceSet` into the submit as `""` like every
    // other `Input.*` (see `input-submit.e2e.test.ts` in channels-teams).
    // The untouched MULTI select next to it already reads `[]` for the same
    // reason; `undefined` would make the two disagree about the same emptiness.
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:approve", type: "button", value: '"yes"' }],
      state: {
        values: {
          "ckf:team": {
            "ck:team": { type: "static_select", selected_option: null },
          },
          "ckf:owners": {
            "ck:owners": {
              type: "multi_static_select",
              selected_options: [],
            },
          },
        },
      },
    });
    expect(evt!.values).toEqual({ team: "", owners: [] });
  });

  it('resolves an untouched single <Select> as "" in `value` too, never `undefined`', () => {
    // The two readers must not disagree: whatever `ctx.values` reports for a
    // choice-less single select, `ctx.action.value` reports the same.
    const el = { type: "static_select", selected_option: null };
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:team", ...el }],
      state: { values: { block1: { "ck:team": el } } },
    });
    expect(evt!.value).toBe("");
    expect(evt!.values!["ck:team"]).toBe("");
  });

  it("still reports a valueless <Button> as `undefined`, not as an empty select", () => {
    // The guard on the reading above: a button carries no `selected_option`
    // slot at all, so `<Button onClick>` with no `value` prop stays absence.
    // Keying the empty reading on the SLOT, not on a missing value, is what
    // keeps these two apart.
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:b", type: "button" }],
    });
    expect(evt!.value).toBeUndefined();
  });

  it("reports empty `values` when the payload carries no block state", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:b", type: "button", value: '"yes"' }],
    });
    expect(evt!.values).toEqual({});
  });

  it("lands a `__proto__` element id as plain data, never on the prototype", () => {
    // `__proto__` survives JSON.parse as an OWN key, so a crafted payload can
    // carry one. Assigned with `values[key] = v` it runs the inherited setter:
    // the handler then sees `values.injected` without `injected` ever appearing
    // in `Object.keys(values)`.
    const evt = decodeInteraction(
      JSON.parse(`{
        "type": "block_actions",
        "container": { "channel_id": "C1", "thread_ts": "200.0" },
        "actions": [{ "action_id": "ck:approve", "type": "button" }],
        "state": {
          "values": {
            "block1": {
              "__proto__": {
                "type": "static_select",
                "selected_option": { "value": "{\\"injected\\":true}" }
              },
              "ck:note": { "type": "plain_text_input", "value": "hi" }
            }
          }
        }
      }`),
    );
    const values = evt!.values!;
    expect(values.injected).toBeUndefined();
    expect(Object.keys(values).sort()).toEqual(["__proto__", "ck:note"]);
    // Verbatim: an option value is never JSON-decoded, so a JSON-shaped one
    // lands as plain data on a plain key rather than as an object.
    expect(values["__proto__"]).toBe('{"injected":true}');
    expect(values["ck:note"]).toBe("hi");
    // The crafted key is a field like any other, not the bag's prototype.
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(values, "__proto__")).toBe(
      true,
    );
  });

  it("hands handlers an ORDINARY object, prototype intact", () => {
    // `values` is public API (`ctx.values`, typed `Record<string, unknown>`)
    // and reaches third-party handlers. Hardening the inbound keys must not
    // cost it `Object.prototype`: `ctx.values.hasOwnProperty(...)` is ordinary
    // consumer code and must keep working.
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:b", type: "button" }],
      state: {
        values: {
          "ckf:reason": {
            "ck:reason": { type: "plain_text_input", value: "ok" },
          },
        },
      },
    });
    const values = evt!.values!;
    expect(values.hasOwnProperty("reason")).toBe(true);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(values.hasOwnProperty("nope")).toBe(false);
    expect(() => String(values)).not.toThrow();
    expect({ ...values }).toEqual({ reason: "ok" });
  });

  it("delivers a submitted field whose id collides with a builtin", () => {
    // The half of prototype hygiene that IS a correctness guarantee: a field
    // the sender actually submitted must reach the handler as its own value,
    // shadowing whatever `Object.prototype` happens to name.
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:b", type: "button" }],
      state: {
        values: {
          "ckf:toString": {
            "ck:a": { type: "plain_text_input", value: "typed" },
          },
          "ckf:constructor": {
            "ck:b": { type: "plain_text_input", value: "ctor" },
          },
        },
      },
    });
    const values = evt!.values!;
    expect(values.toString).toBe("typed");
    expect(values.constructor).toBe("ctor");
    expect(Object.keys(values).sort()).toEqual(["constructor", "toString"]);
  });

  it("keys `values` by the renderer's field ids, round-tripped through real blocks", () => {
    // The half the unit tests above cannot see: the renderer picks the key and
    // the decoder must read back the same one. `name` is the key on Teams (see
    // `fieldId()` in channels-teams' `render/adaptive-card.ts`), so it has to be
    // the key here too, even though `action_id` stays the minted dispatch id.
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "input",
              props: { name: "reason", onSubmit: { id: "ck:in1" } },
            },
            { type: "input", props: { name: "detail" } },
            {
              type: "button",
              props: {
                onClick: { id: "ck:approve" },
                children: [{ type: "text", props: { value: "Approve" } }],
              },
            },
          ],
        },
      },
    ]);

    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:approve", type: "button" }],
      state: { values: textInputState(blocks, ["ship it", "looks good"]) },
    });
    expect(evt!.values).toEqual({ reason: "ship it", detail: "looks good" });
  });

  it("keeps two handler-less <Input>s from overwriting each other", () => {
    // Both used to render `action_id: "input"`, so the flattening dropped one
    // field's text on the floor.
    const blocks = renderBlockKit([
      { type: "input", props: { placeholder: "First" } },
      { type: "input", props: { placeholder: "Second" } },
    ]);

    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C1", thread_ts: "200.0" },
      actions: [{ action_id: "ck:approve", type: "button" }],
      state: { values: textInputState(blocks, ["one", "two"]) },
    });
    expect(evt!.values).toEqual({ input_1: "one", input_2: "two" });
  });

  it("returns undefined for non-block_actions or missing action_id", () => {
    expect(decodeInteraction({ type: "view_submission" })).toBeUndefined();
    expect(
      decodeInteraction({ type: "block_actions", actions: [] }),
    ).toBeUndefined();
    expect(
      decodeInteraction({ type: "block_actions", actions: [{ value: "x" }] }),
    ).toBeUndefined();
  });

  it("returns undefined when no channel can be resolved", () => {
    expect(
      decodeInteraction({
        type: "block_actions",
        actions: [{ action_id: "ck:x" }],
      }),
    ).toBeUndefined();
  });

  it("carries a stable eventId from channel + message ts + action_ts (inbound dedup)", () => {
    const payload = {
      type: "block_actions",
      trigger_id: "trig-123",
      channel: { id: "C1" },
      message: { ts: "111.1", thread_ts: "100.0" },
      actions: [
        { action_id: "ck:abc", value: "yes", action_ts: "1700000000.5" },
      ],
    };
    const evt = decodeInteraction(payload);
    expect(evt!.eventId).toBe("C1:111.1:1700000000.5");
    // Stable: decoding the same payload yields the same eventId.
    expect(decodeInteraction(payload)!.eventId).toBe(evt!.eventId);
  });

  it("falls back to trigger_id for eventId when message/action ts are absent", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      trigger_id: "trig-xyz",
      container: { channel_id: "C3" },
      actions: [{ action_id: "ck:c", value: "x" }],
    });
    expect(evt!.eventId).toBe("trig-xyz");
  });

  it("does NOT require a resume field (opaque id only)", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      channel: { id: "C2" },
      message: { ts: "9.9" },
      actions: [{ action_id: "ck:x" }],
    });
    expect(evt!.id).toBe("ck:x");
    // value is undefined when the button carried none — fine; durability rides
    // on the ActionStore, not the payload.
    expect(evt!.value).toBeUndefined();
  });

  it("carries trigger_id from a block_actions payload", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      trigger_id: "T123.456",
      user: { id: "U1" },
      channel: { id: "C1" },
      message: { ts: "1.0" },
      actions: [{ action_id: "ck:x", value: "v" }],
    });
    expect(evt!.triggerId).toBe("T123.456");
  });
});

describe("decodeViewSubmission field ids vs Object.prototype", () => {
  it("lands a `__proto__` field id as plain data", () => {
    // Same inbound-key hazard as `block_actions`: here the flattened value is a
    // string, so the inherited setter drops it outright and the handler never
    // sees the field at all.
    const evt = decodeViewSubmission(
      JSON.parse(`{
        "callback_id": "triage",
        "state": {
          "values": {
            "__proto__": {
              "__proto__": { "type": "plain_text_input", "value": "pwned" }
            },
            "summary": {
              "summary": { "type": "plain_text_input", "value": "boom" }
            }
          }
        }
      }`),
    );
    expect(Object.keys(evt.values).sort()).toEqual(["__proto__", "summary"]);
    expect(evt.values["__proto__"]).toBe("pwned");
    expect(evt.values.summary).toBe("boom");
    // The crafted key is a field like any other, not the bag's prototype.
    expect(Object.getPrototypeOf(evt.values)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(evt.values, "__proto__")).toBe(
      true,
    );
  });

  it("hands handlers an ORDINARY object, prototype intact", () => {
    // `IncomingModalSubmit.values` reaches an `onModalSubmit` handler verbatim
    // (see channels-core `create-channel.ts`), so it owes the same ordinary-
    // object contract as `ctx.values`.
    const evt = decodeViewSubmission({
      callback_id: "triage",
      state: {
        values: {
          summary: { summary: { type: "plain_text_input", value: "boom" } },
        },
      },
    });
    expect(evt.values.hasOwnProperty("summary")).toBe(true);
    expect(Object.getPrototypeOf(evt.values)).toBe(Object.prototype);
    expect(evt.values.hasOwnProperty("nope")).toBe(false);
    expect(() => String(evt.values)).not.toThrow();
    expect({ ...evt.values }).toEqual({ summary: "boom" });
  });

  it("falls back to the first element for a block id that names a builtin", () => {
    // The inner lookup is by block id too: an unguarded `inner[blockId]` finds
    // `Object.prototype.toString`, which is truthy and so shadows the
    // first-element fallback, yielding `undefined` for a real field.
    const evt = decodeViewSubmission({
      callback_id: "triage",
      state: {
        values: {
          toString: { field: { type: "plain_text_input", value: "typed" } },
        },
      },
    });
    expect(evt.values["toString"]).toBe("typed");
  });
});
