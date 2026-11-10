import {
  MemoryStore,
  type IncomingTurn,
  type InteractionEvent,
} from "@copilotkit/channels-core";
import { describe, expect, it } from "vitest";
import { handleAgentSessionEvent } from "./ingress.js";
import {
  readPendingChoices,
  savePendingChoices,
  type PendingChoiceSet,
} from "./pending-choices.js";
import type {
  AgentSessionEventWebhook,
  LinearWebhookAgentActivity,
} from "./types.js";

const creator = { id: "user_1", name: "Ada Lovelace", email: "ada@acme.dev" };
const issue = {
  id: "iss_1",
  identifier: "ENG-42",
  title: "Checkout fails on Safari",
  description: "Steps: open cart, press Pay.",
  url: "https://linear.app/acme/issue/ENG-42",
};

/** Recorded `created` shape: a mention in an issue comment thread. */
const createdEvent: AgentSessionEventWebhook = {
  type: "AgentSessionEvent",
  action: "created",
  organizationId: "org_1",
  createdAt: "2026-11-10T09:00:00.000Z",
  webhookTimestamp: 1_794_301_200_000,
  agentSession: {
    id: "ses_1",
    issue,
    comment: { id: "com_1", body: "@agent can you look at this?" },
    creator,
  },
  promptContext:
    '<issue identifier="ENG-42"><title>Checkout fails on Safari</title></issue>',
};

/** Recorded `prompted` shape: a follow-up message in the same session. */
function promptedEvent(
  agentActivity: LinearWebhookAgentActivity,
): AgentSessionEventWebhook {
  return {
    type: "AgentSessionEvent",
    action: "prompted",
    organizationId: "org_1",
    createdAt: "2026-11-10T09:05:00.000Z",
    webhookTimestamp: 1_794_301_500_000,
    agentSession: { id: "ses_1", issue, creator },
    agentActivity,
  };
}

/** A teammate who replies in the session but did not create it. */
const prompter = {
  id: "user_2",
  name: "Grace Hopper",
  email: "grace@acme.dev",
};

function prompt(id: string, body: string): LinearWebhookAgentActivity {
  return { id, user: prompter, content: { type: "prompt", body } };
}

const pendingSet: PendingChoiceSet = {
  messageRef: { id: "act_elicit", agentSessionId: "ses_1" },
  choices: [
    {
      label: "Ship it",
      optionValue: "Ship it",
      actionId: "ck:ship",
      value: "ship",
    },
    { label: "Hold", optionValue: "Hold", actionId: "ck:hold", value: "hold" },
  ],
};

async function run(
  payload: AgentSessionEventWebhook,
  store = new MemoryStore(),
) {
  const turns: IncomingTurn[] = [];
  const interactions: InteractionEvent[] = [];
  const stops: string[] = [];
  await handleAgentSessionEvent(payload, {
    sink: {
      onTurn: (turn) => {
        turns.push(turn);
      },
      onInteraction: (event) => {
        interactions.push(event);
      },
    },
    stateStore: store,
    onStop: (agentSessionId) => {
      stops.push(agentSessionId);
    },
  });
  return { turns, interactions, stops, store };
}

async function storeWithPending() {
  const store = new MemoryStore();
  await savePendingChoices(store, pendingSet);
  return store;
}

const replyTarget = {
  organizationId: "org_1",
  agentSessionId: "ses_1",
  issueId: "iss_1",
};
const creatorActor = {
  id: "user_1",
  kind: "human",
  name: "Ada Lovelace",
  email: "ada@acme.dev",
};
const prompterActor = {
  id: "user_2",
  kind: "human",
  name: "Grace Hopper",
  email: "grace@acme.dev",
};

function identity(trigger: string, eventId: string, occurredAt: string) {
  return {
    tenant: { id: "org_1" },
    installation: { id: "org_1" },
    conversation: { id: "linear:ses_1", kind: "thread" },
    trigger,
    event: { id: eventId, occurredAt },
  };
}

describe("handleAgentSessionEvent", () => {
  it("turns a created session into a turn carrying Linear's prompt context", async () => {
    const { turns, interactions } = await run(createdEvent);

    expect(interactions).toEqual([]);
    expect(turns).toEqual([
      {
        platform: "linear",
        conversationKey: "linear:ses_1",
        replyTarget,
        actor: creatorActor,
        eventId: "ses_1:created",
        userText:
          '<issue identifier="ENG-42"><title>Checkout fails on Safari</title></issue>',
        operation: {
          kind: "created",
          logicalMessageId: "ses_1",
          revisionId: "ses_1",
          mentioned: true,
        },
        messageRef: { id: "ses_1", agentSessionId: "ses_1" },
        identityContext: {
          ...identity("mention", "ses_1:created", "2026-11-10T09:00:00.000Z"),
          raw: createdEvent,
        },
      },
    ]);
  });

  it("composes the issue and comment when the created event has no prompt context", async () => {
    const { promptContext: _omitted, ...withoutContext } = createdEvent;

    const { turns } = await run(withoutContext);

    expect(turns.map((turn) => turn.userText)).toEqual([
      "ENG-42: Checkout fails on Safari\n\nSteps: open cart, press Pay.\n\n@agent can you look at this?",
    ]);
  });

  it("turns a prompted message into a turn from the user who sent it", async () => {
    const payload = promptedEvent(prompt("act_2", "Try Safari 17 too."));

    const { turns } = await run(payload);

    expect(turns).toEqual([
      {
        platform: "linear",
        conversationKey: "linear:ses_1",
        replyTarget,
        actor: prompterActor,
        eventId: "act_2",
        userText: "Try Safari 17 too.",
        operation: {
          kind: "created",
          logicalMessageId: "act_2",
          revisionId: "act_2",
          mentioned: true,
        },
        messageRef: { id: "act_2", agentSessionId: "ses_1" },
        identityContext: {
          ...identity("message", "act_2", "2026-11-10T09:05:00.000Z"),
          raw: payload,
        },
      },
    ]);
  });

  it("falls back to the session creator when the activity names no user", async () => {
    const { user: _omitted, ...withoutUser } = prompt("act_7", "Any update?");

    const { turns } = await run(promptedEvent(withoutUser));

    expect(turns.map((turn) => turn.actor)).toEqual([creatorActor]);
  });

  it("calls onStop and starts no turn for the stop signal", async () => {
    const payload = promptedEvent({
      ...prompt("act_3", "Stop"),
      signal: "stop",
    });

    const { turns, interactions, stops } = await run(payload);

    expect({ turns, interactions, stops }).toEqual({
      turns: [],
      interactions: [],
      stops: ["ses_1"],
    });
  });

  it("turns a pick of a pending option into an interaction and clears the set", async () => {
    const payload = promptedEvent(prompt("act_4", "Ship it"));

    const { turns, interactions, store } = await run(
      payload,
      await storeWithPending(),
    );

    expect(turns).toEqual([]);
    expect(interactions).toEqual([
      {
        platform: "linear",
        conversationKey: "linear:ses_1",
        replyTarget,
        actor: prompterActor,
        eventId: "act_4",
        id: "ck:ship",
        value: "ship",
        rawValue: "ship",
        messageRef: { id: "act_elicit", agentSessionId: "ses_1" },
        identityContext: {
          ...identity("interaction", "act_4", "2026-11-10T09:05:00.000Z"),
          raw: payload,
        },
      },
    ]);
    expect(await readPendingChoices(store, "ses_1")).toBe(undefined);
  });

  it("matches a pending option by its label ignoring case", async () => {
    const { interactions } = await run(
      promptedEvent(prompt("act_5", "hold")),
      await storeWithPending(),
    );

    expect(interactions.map((event) => [event.id, event.value])).toEqual([
      ["ck:hold", "hold"],
    ]);
  });

  it("keeps the pending set and starts a turn when the body picks no option", async () => {
    const { turns, interactions, store } = await run(
      promptedEvent(prompt("act_6", "What does Hold do?")),
      await storeWithPending(),
    );

    expect(interactions).toEqual([]);
    expect(turns.map((turn) => turn.userText)).toEqual(["What does Hold do?"]);
    expect(await readPendingChoices(store, "ses_1")).toEqual(pendingSet);
  });

  it("ignores an action it does not handle", async () => {
    // The webhook handler parses JSON and trusts the event type, so an action
    // Linear adds later reaches ingress as-is. Parse to model that boundary.
    const payload: AgentSessionEventWebhook = JSON.parse(
      JSON.stringify({ ...createdEvent, action: "updated" }),
    );

    const { turns, interactions, stops } = await run(payload);

    expect({ turns, interactions, stops }).toEqual({
      turns: [],
      interactions: [],
      stops: [],
    });
  });
});
