import { MemoryStore } from "@copilotkit/channels-core";
import type { IncomingTurn, InteractionEvent } from "@copilotkit/channels-core";
import { describe, expect, it } from "vitest";
import { handleGitHubEvent } from "./ingress.js";
import { readPendingChoices, savePendingChoices } from "./pending-choices.js";
import type { PendingChoices } from "./pending-choices.js";
import type {
  GitHubUser,
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
} from "./types.js";
import type { GitHubWebhookEvent } from "./webhook.js";

const DELIVERY_ID = "d6a1c2e0-9f3b-11ef-8b5e-1f2a3b4c5d6e";
const INSTALLATION_ID = 51234567;
const CREATED_AT = "2026-11-10T09:15:00Z";
const BOT_LOGIN = "acme-helper";

const OCTOCAT: GitHubUser = { login: "octocat", id: 583231, type: "User" };
const BOT_USER: GitHubUser = {
  login: "acme-helper[bot]",
  id: 9001,
  type: "Bot",
};
const OTHER_BOT: GitHubUser = {
  login: "dependabot[bot]",
  id: 49699333,
  type: "Bot",
};

const REPOSITORY = { name: "widgets", owner: { login: "acme" } };

interface CommentInit {
  body: string;
  user?: GitHubUser;
  action?: string;
}

/** `issue_comment` delivery on issue #42 (recorded payload shape, trimmed). */
function issueComment(init: CommentInit): GitHubWebhookEvent {
  const user = init.user ?? OCTOCAT;
  const payload: IssueCommentEvent = {
    action: init.action ?? "created",
    issue: { number: 42 },
    comment: {
      id: 2468013579,
      body: init.body,
      user,
      html_url:
        "https://github.com/acme/widgets/issues/42#issuecomment-2468013579",
      created_at: CREATED_AT,
    },
    repository: REPOSITORY,
    installation: { id: INSTALLATION_ID },
    sender: user,
  };
  return { name: "issue_comment", deliveryId: DELIVERY_ID, payload };
}

/** `issue_comment` delivery on PR #7, sent with a PAT webhook (no installation). */
function pullRequestTimelineComment(body: string): GitHubWebhookEvent {
  const payload: IssueCommentEvent = {
    action: "created",
    issue: {
      number: 7,
      pull_request: {
        url: "https://api.github.com/repos/acme/widgets/pulls/7",
      },
    },
    comment: {
      id: 1357924680,
      body,
      user: OCTOCAT,
      html_url:
        "https://github.com/acme/widgets/pull/7#issuecomment-1357924680",
      created_at: CREATED_AT,
    },
    repository: REPOSITORY,
    sender: OCTOCAT,
  };
  return { name: "issue_comment", deliveryId: DELIVERY_ID, payload };
}

/** `pull_request_review_comment` delivery on PR #7. */
function reviewComment(
  body: string,
  ids: { id: number; inReplyToId?: number },
): GitHubWebhookEvent {
  const payload: PullRequestReviewCommentEvent = {
    action: "created",
    pull_request: { number: 7 },
    comment: {
      id: ids.id,
      body,
      user: OCTOCAT,
      html_url: `https://github.com/acme/widgets/pull/7#discussion_r${ids.id}`,
      in_reply_to_id: ids.inReplyToId,
      created_at: CREATED_AT,
    },
    repository: REPOSITORY,
    installation: { id: INSTALLATION_ID },
    sender: OCTOCAT,
  };
  return {
    name: "pull_request_review_comment",
    deliveryId: DELIVERY_ID,
    payload,
  };
}

const ISSUE_KEY = "github:acme/widgets#42";
const ISSUE_TARGET = {
  installationId: INSTALLATION_ID,
  owner: "acme",
  repo: "widgets",
  issueNumber: 42,
};

const PENDING: PendingChoices = {
  messageRef: {
    id: 2468000001,
    kind: "issue",
    owner: "acme",
    repo: "widgets",
    issueNumber: 42,
  },
  choices: [
    { index: 1, label: "Deploy", actionId: "ck:deploy", value: "deploy" },
    { index: 2, label: "Cancel", actionId: "github:choice", value: "cancel" },
  ],
};

async function deliver(
  event: GitHubWebhookEvent,
  options: { pending?: PendingChoices; botLogin?: string } = {},
) {
  const stateStore = new MemoryStore();
  if (options.pending) {
    await savePendingChoices(stateStore, ISSUE_KEY, options.pending);
  }
  const turns: IncomingTurn[] = [];
  const interactions: InteractionEvent[] = [];
  await handleGitHubEvent(event, {
    sink: {
      onTurn: (turn) => {
        turns.push(turn);
      },
      onInteraction: (interaction) => {
        interactions.push(interaction);
      },
    },
    stateStore,
    botLogin: () => options.botLogin ?? BOT_LOGIN,
  });
  return { turns, interactions, stateStore };
}

function onlyTurn(turns: IncomingTurn[]) {
  expect(turns).toHaveLength(1);
  const [turn] = turns;
  if (turn === undefined) throw new Error("expected exactly one turn");
  return turn;
}

describe("handleGitHubEvent: turns", () => {
  it.each([BOT_LOGIN, "acme-helper[bot]", "@Acme-Helper"])(
    "turns an issue comment that mentions the bot into a turn (bot login %j)",
    async (botLogin) => {
      const event = issueComment({ body: "Hey @acme-helper, summarize this" });
      const { turns, interactions } = await deliver(event, { botLogin });

      expect(interactions).toEqual([]);
      expect(turns).toEqual([
        {
          conversationKey: ISSUE_KEY,
          replyTarget: { ...ISSUE_TARGET, triggerCommentId: 2468013579 },
          actor: { id: "583231", name: "octocat", kind: "human" },
          identityContext: {
            tenant: { id: "51234567" },
            installation: { id: "51234567" },
            conversation: { id: ISSUE_KEY, kind: "thread" },
            trigger: "message",
            event: { id: DELIVERY_ID, occurredAt: CREATED_AT },
            raw: event.payload,
          },
          platform: "github",
          eventId: DELIVERY_ID,
          userText: "Hey summarize this",
          operation: {
            kind: "created",
            logicalMessageId: "issue-comment:2468013579",
            revisionId: "issue-comment:2468013579",
            mentioned: true,
          },
          messageRef: {
            id: "2468013579",
            kind: "issue",
            owner: "acme",
            repo: "widgets",
            issueNumber: 42,
          },
        },
      ]);
    },
  );

  it("keys a PR timeline comment by the PR and uses the owner as tenant without an installation", async () => {
    const { turns } = await deliver(
      pullRequestTimelineComment("@ACME-HELPER[bot] review please"),
    );

    const turn = onlyTurn(turns);
    expect(turn.conversationKey).toBe("github:acme/widgets#7");
    expect(turn.replyTarget).toEqual({
      owner: "acme",
      repo: "widgets",
      issueNumber: 7,
      triggerCommentId: 1357924680,
    });
    expect(turn.identityContext.tenant).toEqual({ id: "acme" });
    expect(turn.userText).toBe("review please");
    expect(turn.messageRef).toEqual({
      id: "1357924680",
      kind: "issue",
      owner: "acme",
      repo: "widgets",
      issueNumber: 7,
    });
  });

  it.each([
    { name: "a reply in a thread", inReplyToId: 1111, root: 1111 },
    {
      name: "the comment that starts a thread",
      inReplyToId: undefined,
      root: 2222,
    },
  ])(
    "replies to $name in the review thread rooted at its first comment",
    async ({ inReplyToId, root }) => {
      const { turns } = await deliver(
        reviewComment("@acme-helper why this change?", {
          id: 2222,
          inReplyToId,
        }),
      );

      const turn = onlyTurn(turns);
      expect(turn.conversationKey).toBe(`github:acme/widgets#7/r${root}`);
      expect(turn.replyTarget).toEqual({
        installationId: INSTALLATION_ID,
        owner: "acme",
        repo: "widgets",
        issueNumber: 7,
        reviewCommentId: root,
        triggerCommentId: 2222,
      });
      expect(turn.userText).toBe("why this change?");
      expect(turn.operation.logicalMessageId).toBe("review-comment:2222");
      expect(turn.messageRef).toEqual({
        id: "2222",
        kind: "review",
        owner: "acme",
        repo: "widgets",
        issueNumber: 7,
      });
    },
  );
});

describe("handleGitHubEvent: ignored deliveries", () => {
  it.each([
    {
      name: "the bot's own comment",
      event: issueComment({ body: "@acme-helper done", user: BOT_USER }),
    },
    {
      name: "another bot's comment",
      event: issueComment({ body: "@acme-helper rebase", user: OTHER_BOT }),
    },
    {
      name: "a comment without a mention",
      event: issueComment({ body: "Looks good to me" }),
    },
    {
      name: "an email-like mention",
      event: issueComment({ body: "mail ops@acme-helper.dev" }),
    },
    {
      name: "a longer login",
      event: issueComment({ body: "@acme-helper-two hi" }),
    },
    {
      name: "an edited comment",
      event: issueComment({ body: "@acme-helper hi", action: "edited" }),
    },
    {
      name: "an unsupported event",
      event: {
        name: "issues",
        deliveryId: DELIVERY_ID,
        payload: { action: "created" },
      },
    },
  ])("ignores $name", async ({ event }) => {
    const { turns, interactions } = await deliver(event);
    expect(turns).toEqual([]);
    expect(interactions).toEqual([]);
  });
});

describe("handleGitHubEvent: numbered replies", () => {
  it("decodes a numbered reply to the pending list and clears the list", async () => {
    const event = issueComment({ body: "2" });
    const { turns, interactions, stateStore } = await deliver(event, {
      pending: PENDING,
    });

    expect(turns).toEqual([]);
    expect(interactions).toEqual([
      {
        conversationKey: ISSUE_KEY,
        replyTarget: ISSUE_TARGET,
        actor: { id: "583231", name: "octocat", kind: "human" },
        identityContext: {
          tenant: { id: "51234567" },
          installation: { id: "51234567" },
          conversation: { id: ISSUE_KEY, kind: "thread" },
          trigger: "interaction",
          event: { id: DELIVERY_ID, occurredAt: CREATED_AT },
          raw: event.payload,
        },
        platform: "github",
        eventId: DELIVERY_ID,
        id: "github:choice",
        value: "cancel",
        rawValue: "cancel",
        messageRef: {
          id: "2468000001",
          kind: "issue",
          owner: "acme",
          repo: "widgets",
          issueNumber: 42,
        },
      },
    ]);
    expect(await readPendingChoices(stateStore, ISSUE_KEY)).toBeUndefined();
  });

  it.each(["deploy", "@acme-helper 1"])(
    "decodes the reply %j to the first option",
    async (body) => {
      const { turns, interactions } = await deliver(issueComment({ body }), {
        pending: PENDING,
      });
      expect(turns).toEqual([]);
      expect(interactions.map(({ id, value }) => ({ id, value }))).toEqual([
        { id: "ck:deploy", value: "deploy" },
      ]);
    },
  );

  it("ignores an out-of-range number and keeps the list", async () => {
    const { turns, interactions, stateStore } = await deliver(
      issueComment({ body: "7" }),
      { pending: PENDING },
    );
    expect(turns).toEqual([]);
    expect(interactions).toEqual([]);
    expect(await readPendingChoices(stateStore, ISSUE_KEY)).toEqual(PENDING);
  });

  it("turns an out-of-range number that mentions the bot into a turn", async () => {
    const { turns, interactions } = await deliver(
      issueComment({ body: "@acme-helper 7" }),
      { pending: PENDING },
    );
    expect(interactions).toEqual([]);
    expect(turns.map((turn) => turn.userText)).toEqual(["7"]);
  });
});
