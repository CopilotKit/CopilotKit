import { MemoryStore } from "@copilotkit/channels-core";
import type { IncomingTurn, InteractionEvent } from "@copilotkit/channels-core";
import { describe, expect, it } from "vitest";
import {
  markJoined,
  readPendingChoices,
  savePendingChoices,
} from "./conversation-state.js";
import type { PendingChoices } from "./conversation-state.js";
import { handleNotionEvent } from "./ingress.js";
import type { NotionIngressDeps } from "./ingress.js";
import type {
  NotionComment,
  NotionWebhookEvent,
  RichTextItem,
} from "./types.js";

const BOT = { id: "bot-1", name: "Acme Bot" };

/** Recorded shape of a `comment.created` delivery (ids replaced). */
function createEvent(overrides: Partial<NotionWebhookEvent> = {}) {
  const event: NotionWebhookEvent = {
    id: "evt-1",
    timestamp: "2026-11-10T09:15:00.000Z",
    workspace_id: "ws-1",
    workspace_name: "Acme",
    subscription_id: "sub-1",
    integration_id: "int-1",
    type: "comment.created",
    authors: [{ id: "user-1", type: "person" }],
    attempt_number: 1,
    entity: { id: "comment-1", type: "comment" },
    data: { page_id: "page-1", parent: { id: "page-1", type: "page" } },
    ...overrides,
  };
  return event;
}

/** Recorded shape of `GET /v1/comments/{id}`. */
function createComment(
  richText: RichTextItem[],
  overrides: Partial<NotionComment> = {},
) {
  const comment: NotionComment = {
    object: "comment",
    id: "comment-1",
    discussion_id: "disc-1",
    parent: { type: "page_id", page_id: "page-1" },
    created_by: { object: "user", id: "user-1" },
    created_time: "2026-11-10T09:15:00.000Z",
    last_edited_time: "2026-11-10T09:15:00.000Z",
    rich_text: richText,
    ...overrides,
  };
  return comment;
}

function text(content: string): RichTextItem {
  return {
    type: "text",
    text: { content, link: null },
    annotations: { bold: false, italic: false, code: false, color: "default" },
    plain_text: content,
    href: null,
  };
}

function mention(userId: string, plainText: string): RichTextItem {
  return {
    type: "mention",
    mention: { type: "user", user: { object: "user", id: userId } },
    annotations: { bold: false, italic: false, code: false, color: "default" },
    plain_text: plainText,
    href: null,
  };
}

const IDENTITY = {
  tenant: { id: "ws-1" },
  installation: { id: "int-1" },
  conversation: { id: "notion:disc-1", kind: "thread" },
  event: { id: "evt-1", occurredAt: "2026-11-10T09:15:00.000Z" },
};

const PENDING: PendingChoices = {
  messageRef: { id: "comment-bot", discussionId: "disc-1" },
  choices: [
    { index: 1, label: "Approve", actionId: "ck:approve", value: "yes" },
    { index: 2, label: "Reject", actionId: "ck:reject", value: "no" },
  ],
};

interface Setup {
  comment: NotionComment;
  event?: NotionWebhookEvent;
  trigger?: string;
  joined?: boolean;
  pending?: PendingChoices;
}

/** Run one event through ingress with a fake API client and a recording sink. */
async function ingest(setup: Setup) {
  const stateStore = new MemoryStore();
  if (setup.joined) await markJoined(stateStore, "disc-1");
  if (setup.pending)
    await savePendingChoices(stateStore, "disc-1", setup.pending);
  const turns: IncomingTurn[] = [];
  const interactions: InteractionEvent[] = [];
  const event = setup.event ?? createEvent();
  const deps: NotionIngressDeps = {
    sink: {
      onTurn: (turn) => {
        turns.push(turn);
      },
      onInteraction: (evt) => {
        interactions.push(evt);
      },
    },
    stateStore,
    client: {
      retrieveComment: async (id) => {
        if (id !== setup.comment.id) throw new Error(`no comment ${id}`);
        return setup.comment;
      },
    },
    bot: async () => BOT,
    ...(setup.trigger === undefined ? {} : { trigger: setup.trigger }),
  };
  await handleNotionEvent(event, deps);
  const pendingAfter = await readPendingChoices(stateStore, "disc-1");
  return { turns, interactions, event, pendingAfter };
}

describe("handleNotionEvent", () => {
  it("turns a comment that mentions the bot into a turn without the mention", async () => {
    const comment = createComment([
      mention("bot-1", "@Acme Bot"),
      text(" summarize this page "),
    ]);
    const { turns, interactions, event } = await ingest({ comment });

    expect(interactions).toEqual([]);
    expect(turns).toEqual([
      {
        conversationKey: "notion:disc-1",
        replyTarget: {
          workspaceId: "ws-1",
          pageId: "page-1",
          discussionId: "disc-1",
        },
        actor: { id: "user-1", kind: "human" },
        eventId: "evt-1",
        userText: "summarize this page",
        operation: {
          kind: "created",
          logicalMessageId: "comment-1",
          revisionId: "comment-1",
          mentioned: true,
        },
        messageRef: { id: "comment-1", discussionId: "disc-1" },
        identityContext: {
          ...IDENTITY,
          trigger: "message",
          raw: { event, comment },
        },
        platform: "notion",
      },
    ]);
  });

  it("turns a comment that starts with the default @<bot name> text, ignoring case", async () => {
    const comment = createComment([text("@acme bot what changed?")]);
    const { turns } = await ingest({ comment });

    expect(
      turns.map((turn) => [turn.userText, turn.operation.mentioned]),
    ).toEqual([["what changed?", true]]);
  });

  it("uses a configured trigger instead of the bot name", async () => {
    const { turns } = await ingest({
      comment: createComment([text("!ask list the owners")]),
      trigger: "!ask",
    });

    expect(turns.map((turn) => turn.userText)).toEqual(["list the owners"]);
  });

  it("turns any comment in a joined discussion, without a mention", async () => {
    const { turns } = await ingest({
      comment: createComment([text("and the risks?")]),
      joined: true,
    });

    expect(
      turns.map((turn) => [turn.userText, turn.operation.mentioned]),
    ).toEqual([["and the risks?", false]]);
  });

  it("ignores a comment that does not address the bot", async () => {
    const { turns, interactions } = await ingest({
      comment: createComment([
        text("ping "),
        mention("user-2", "@Dana"),
        text(" about @Acme Bot"),
      ]),
    });

    expect({ turns, interactions }).toEqual({ turns: [], interactions: [] });
  });

  it("ignores a mention with no text after it", async () => {
    const { turns } = await ingest({
      comment: createComment([mention("bot-1", "@Acme Bot"), text("  ")]),
    });

    expect(turns).toEqual([]);
  });

  it("ignores an event whose only author is the bot", async () => {
    const { turns } = await ingest({
      comment: createComment([text("Done.")]),
      event: createEvent({ authors: [{ id: "bot-1", type: "bot" }] }),
      joined: true,
    });

    expect(turns).toEqual([]);
  });

  it("ignores a comment the bot created", async () => {
    const { turns } = await ingest({
      comment: createComment([mention("bot-1", "@Acme Bot"), text(" hi")], {
        created_by: { object: "user", id: "bot-1" },
      }),
      event: createEvent({ authors: [] }),
    });

    expect(turns).toEqual([]);
  });

  it("ignores events other than comment.created", async () => {
    const { turns, interactions } = await ingest({
      comment: createComment([mention("bot-1", "@Acme Bot"), text(" hi")]),
      event: createEvent({ type: "comment.updated" }),
    });

    expect({ turns, interactions }).toEqual({ turns: [], interactions: [] });
  });

  it("takes the page id from the comment when the event has none", async () => {
    const { turns } = await ingest({
      comment: createComment([mention("bot-1", "@Acme Bot"), text(" hi")], {
        parent: { type: "page_id", page_id: "page-9" },
      }),
      event: createEvent({ data: {} }),
    });

    expect(turns.map((turn) => turn.replyTarget)).toEqual([
      { workspaceId: "ws-1", pageId: "page-9", discussionId: "disc-1" },
    ]);
  });

  it("decodes a numbered reply into an interaction and clears the pending choices", async () => {
    const comment = createComment([text("2")]);
    const { turns, interactions, pendingAfter, event } = await ingest({
      comment,
      joined: true,
      pending: PENDING,
    });

    expect(turns).toEqual([]);
    expect(interactions).toEqual([
      {
        conversationKey: "notion:disc-1",
        replyTarget: {
          workspaceId: "ws-1",
          pageId: "page-1",
          discussionId: "disc-1",
        },
        actor: { id: "user-1", kind: "human" },
        eventId: "evt-1",
        identityContext: {
          ...IDENTITY,
          trigger: "interaction",
          raw: { event, comment },
        },
        id: "ck:reject",
        value: "no",
        rawValue: "no",
        messageRef: { id: "comment-bot", discussionId: "disc-1" },
      },
    ]);
    expect(pendingAfter).toBeUndefined();
  });

  it("decodes a label reply that follows a bot mention", async () => {
    const { interactions, pendingAfter } = await ingest({
      comment: createComment([mention("bot-1", "@Acme Bot"), text(" approve")]),
      pending: PENDING,
    });

    expect(interactions.map((evt) => [evt.id, evt.value])).toEqual([
      ["ck:approve", "yes"],
    ]);
    expect(pendingAfter).toBeUndefined();
  });

  it("keeps a non-matching reply as a turn and leaves the choices pending", async () => {
    const { turns, interactions, pendingAfter } = await ingest({
      comment: createComment([text("what does reject do?")]),
      joined: true,
      pending: PENDING,
    });

    expect(interactions).toEqual([]);
    expect(turns.map((turn) => turn.userText)).toEqual([
      "what does reject do?",
    ]);
    expect(pendingAfter).toEqual(PENDING);
  });
});
