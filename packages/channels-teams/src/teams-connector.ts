import {
  CloudAdapter,
  CardFactory,
  MessageFactory,
} from "@microsoft/agents-hosting";
import type { AuthConfiguration, TurnContext } from "@microsoft/agents-hosting";
import { ActivityTypes, Activity } from "@microsoft/agents-activity";
import type { ConversationReference } from "@microsoft/agents-activity";
import type { IngressSink } from "@copilotkit/channels-core";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import { createTeamsServer } from "./listener.js";
import type { TeamsServer } from "./listener.js";
import { conversationKeyOf, parseCardAction } from "./interaction.js";
import { classifyConversation } from "./ingress-normalize.js";
import { buildFileContentParts } from "./download-files.js";
import type {
  TeamsAttachmentRef,
  FileDeliveryConfig,
} from "./download-files.js";
import { buildChannelFileContentParts } from "./graph-files.js";
import type { GraphCredentials, ChannelMessageRef } from "./graph-files.js";
import type { AdaptiveCard } from "./render/adaptive-card.js";

/** Native render output the connector sends: a plain text activity or an Adaptive Card attachment. */
export type TeamsActivityPayload = { text: string } | { card: AdaptiveCard };

/**
 * The addressing data a connector egress call needs: a live turn context
 * (present only while replying inside the originating activity, e.g. an
 * anonymous-mode turn) and/or a `ConversationReference` for proactive
 * re-entry. Deliberately more permissive than `types.ts`'s `TeamsReplyTarget`
 * (whose `reference` is required) — a `MessageRef` returned by `sendActivity`
 * only ever carries `context`, so both shapes must satisfy this.
 */
export interface TeamsSendTarget {
  /** Present on real reply targets/message refs; connector methods don't need it themselves. */
  conversationKey?: string;
  context?: TurnContext;
  reference?: Partial<ConversationReference>;
}

/** A file attachment to send — plain data, no credentials. */
export interface TeamsOutboundFile {
  contentType: string;
  contentUrl: string;
  name: string;
}

/**
 * Everything the adapter hands the connector to start OWNING the live Teams
 * connection (mirrors `SlackIngressConfig`): only serializable config + the
 * sink + a callback cross this port. `recordUser` is a callback so its
 * DECISION logic (persisting to the transcript) stays adapter-side even
 * though the connector is what invokes it per raw activity.
 */
export interface TeamsIngressConfig {
  /** Where every normalized turn/interaction lands. */
  sink: IngressSink;
  /** Tunables for inbound file handling (size/count caps). */
  files?: FileDeliveryConfig;
  /** Persist an inbound user message to the conversation transcript (adapter-owned decision). */
  recordUser: (
    conversationKey: string,
    content: string | AgentContentPart[],
  ) => void;
}

/** Connection facts resolved once ingress starts. Teams has none today (unlike Slack's botUserId/assistantHandle). */
export type TeamsIngressConnection = Record<string, never>;

/**
 * Every credentialed Teams operation `TeamsAdapter` performs, behind a port
 * whose method signatures carry only serializable data (a `TeamsSendTarget`,
 * rendered text/card, plain file data) — never a `CloudAdapter` instance or a
 * client secret. The adapter holds NO credentials of its own — every method
 * here is reached only through a connector a runner INJECTS via
 * `TeamsAdapter.ɵbindConnector`; calling any adapter egress method or
 * `start()` before that throws.
 *
 * `TeamsSendTarget` may still carry a live `context` (set only while a
 * turn/interaction is running in-turn, e.g. the anonymous M365 Agents
 * Playground) — that's a per-turn addressing handle, not a credential; the
 * SAME opaque-target idiom `ReplyTarget` already uses elsewhere. When absent,
 * the connector re-enters the conversation via its own credentialed
 * `continueConversation`.
 */
export interface TeamsConnector {
  /** Post a new activity (text or Adaptive Card). Returns the posted activity id. */
  sendActivity(
    target: TeamsSendTarget,
    payload: TeamsActivityPayload,
  ): Promise<string>;
  /** Edit a previously-posted activity in place. */
  updateActivity(
    target: TeamsSendTarget,
    id: string,
    payload: TeamsActivityPayload,
  ): Promise<void>;
  /** Delete a previously-posted activity. Only possible on a live turn context (no proactive delete). */
  deleteActivity(target: TeamsSendTarget, id: string): Promise<void>;
  /** Fire a typing indicator. Only possible on a live turn context (best-effort, never throws). */
  sendTyping(target: TeamsSendTarget): Promise<void>;
  /** Post a file attachment (e.g. an inline `data:` image). Returns the posted activity id. */
  sendFile(target: TeamsSendTarget, file: TeamsOutboundFile): Promise<string>;

  /**
   * Start OWNING the live Teams connection: build the `CloudAdapter`'s HTTP
   * endpoint (`POST /api/messages`), authenticate/normalize every inbound
   * activity — Adaptive Card `Action.Submit` clicks, ordinary chat messages
   * (with inbound-file resolution, credentialed Graph reads for channel
   * files included) — and forward each to `config.sink`. Resolves once the
   * server is listening.
   */
  startIngress(config: TeamsIngressConfig): Promise<TeamsIngressConnection>;
  /** Stop the live connection started by {@link startIngress}. */
  stopIngress(): Promise<void>;
}

/** Constructor config for {@link CloudAdapterTeamsConnector} — everything Teams-credential-shaped now lives HERE, not on the adapter. */
export interface CloudAdapterTeamsConnectorOptions {
  /**
   * Port for the bot's `POST /api/messages` endpoint. Defaults to `3978`, the
   * endpoint the M365 Agents Playground connects to.
   */
  port?: number;
  /**
   * Microsoft app (client) id. Omit for anonymous local development with the
   * M365 Agents Playground; required to talk to real Teams via Azure Bot
   * Service.
   */
  clientId?: string;
  /** Microsoft client secret. Omit for anonymous local dev. */
  clientSecret?: string;
  /** Microsoft tenant (directory) id. Omit for multi-tenant / anonymous. */
  tenantId?: string;
}

/**
 * The default {@link TeamsConnector}: CREDENTIAL-OWNING — constructed with
 * `clientId`/`clientSecret`/`tenantId` and building BOTH its own `CloudAdapter`
 * (egress + ingress) and (on {@link startIngress}) its own HTTP listener
 * internally. Nothing token-shaped ever crosses back out to the adapter. A
 * runner (custom `ChannelRunner`, or the managed Connector Outbox's own
 * implementation of this interface) constructs one of these — or an
 * equivalent — and injects it via `TeamsAdapter.ɵbindConnector`.
 */
export class CloudAdapterTeamsConnector implements TeamsConnector {
  private readonly cloud: CloudAdapter;
  private readonly port: number;
  private readonly clientId: string | undefined;
  /** App-only Graph credentials, when all three are configured (backs channel-file reads). */
  private readonly graphCreds: GraphCredentials | undefined;
  private server: TeamsServer | undefined;

  constructor(opts: CloudAdapterTeamsConnectorOptions = {}) {
    this.port = opts.port ?? 3978;
    this.clientId = opts.clientId;
    const authConfig: AuthConfiguration = {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      tenantId: opts.tenantId,
    };
    this.cloud = new CloudAdapter(authConfig);
    // Contain turn-handler failures at the SDK boundary. Without this the M365
    // adapter rethrows (e.g. a Bot Connector 401 surfaces as "Unknown error
    // type"), which becomes an unhandled rejection and crashes the process,
    // turning one bad turn into a service-wide outage + restart loop.
    this.cloud.onTurnError = async (_context, error) => {
      console.error("[bot-teams] turn error:", error);
    };
    this.graphCreds =
      opts.clientId && opts.clientSecret && opts.tenantId
        ? {
            clientId: opts.clientId,
            clientSecret: opts.clientSecret,
            tenantId: opts.tenantId,
          }
        : undefined;
  }

  /** Whether we can send proactively (out-of-turn). Requires a Microsoft app id. */
  private canGoProactive(): boolean {
    return Boolean(this.clientId);
  }

  /**
   * Run `fn` against a proactive `TurnContext` opened by `continueConversation`,
   * detached from any inbound HTTP turn. Fire-and-forget: the caller acks the
   * inbound turn immediately and this runs (and may suspend at `awaitChoice`)
   * in the background. Errors are logged, never surfaced to the inbound turn.
   */
  private runDetached(
    reference: Partial<ConversationReference>,
    fn: (context: TurnContext) => Promise<void>,
  ): void {
    void this.withProactive(reference, fn).catch((err) => {
      console.error("[bot-teams] detached turn failed:", err);
    });
  }

  /** Open a proactive `TurnContext` for the conversation and await `fn`. */
  private async withProactive(
    reference: Partial<ConversationReference>,
    fn: (context: TurnContext) => Promise<void>,
  ): Promise<void> {
    const appId = this.clientId ?? "";
    await this.cloud.continueConversation(
      appId,
      reference as Parameters<CloudAdapter["continueConversation"]>[1],
      (context) => fn(context),
    );
  }

  /**
   * Run `fn` on the target's live turn context if one is open, else re-enter
   * the conversation proactively via its reference. Returns `undefined` (a
   * no-op) when neither is available. Shared by every egress op below except
   * {@link deleteActivity}/{@link sendTyping}, which (like the pre-gut
   * adapter) only ever act on a LIVE context — there is no proactive delete
   * or proactive typing indicator.
   */
  private async withContext<T>(
    target: TeamsSendTarget,
    fn: (context: TurnContext) => Promise<T>,
  ): Promise<T | undefined> {
    if (target.context) return fn(target.context);
    if (target.reference) {
      let result: T | undefined;
      await this.withProactive(target.reference, async (context) => {
        result = await fn(context);
      });
      return result;
    }
    return undefined;
  }

  private activityFor(payload: TeamsActivityPayload): Activity {
    return "text" in payload
      ? MessageFactory.text(payload.text)
      : MessageFactory.attachment(CardFactory.adaptiveCard(payload.card));
  }

  async sendActivity(
    target: TeamsSendTarget,
    payload: TeamsActivityPayload,
  ): Promise<string> {
    if ("text" in payload && !payload.text.trim()) return "";
    const activity = this.activityFor(payload);
    const id = await this.withContext(
      target,
      async (context) => (await context.sendActivity(activity))?.id ?? "",
    );
    return id ?? "";
  }

  async updateActivity(
    target: TeamsSendTarget,
    id: string,
    payload: TeamsActivityPayload,
  ): Promise<void> {
    if (!id) return;
    // `updateActivity` re-derives addressing from the turn, so we build a fresh
    // activity carrying only the id + new content.
    const activity = this.activityFor(payload);
    activity.id = id;
    await this.withContext(target, (context) =>
      context.updateActivity(activity),
    );
  }

  async deleteActivity(target: TeamsSendTarget, id: string): Promise<void> {
    if (!target.context || !id) return;
    await target.context.deleteActivity(id);
  }

  async sendTyping(target: TeamsSendTarget): Promise<void> {
    if (!target.context) return;
    try {
      await target.context.sendActivity(new Activity(ActivityTypes.Typing));
    } catch {
      // Typing is best-effort; never let it sink a reply.
    }
  }

  async sendFile(
    target: TeamsSendTarget,
    file: TeamsOutboundFile,
  ): Promise<string> {
    const activity = MessageFactory.attachment({
      contentType: file.contentType,
      contentUrl: file.contentUrl,
      name: file.name,
    });
    const id = await this.withContext(
      target,
      async (context) => (await context.sendActivity(activity))?.id ?? "",
    );
    if (id === undefined) {
      throw new Error("no live or proactive context to post on");
    }
    return id;
  }

  async startIngress(
    config: TeamsIngressConfig,
  ): Promise<TeamsIngressConnection> {
    this.server = createTeamsServer({
      adapter: this.cloud,
      port: this.port,
      onTurnContext: (context) => this.handleActivity(context, config),
    });
    await this.server.start();
    return {};
  }

  async stopIngress(): Promise<void> {
    await this.server?.stop();
  }

  /**
   * Normalize an inbound activity, ack the HTTP turn immediately, and drive the
   * work into the sink on a **detached** `continueConversation` (when
   * credentialed) so it can outlive this turn (HITL suspends the run until a
   * later click). Anonymous/local mode (no app id) runs in-turn instead, since
   * `continueConversation` needs an app id we don't have there.
   */
  private async handleActivity(
    context: TurnContext,
    config: TeamsIngressConfig,
  ): Promise<void> {
    const activity = context.activity;
    if (activity.type !== ActivityTypes.Message) return;

    const conversationKey = conversationKeyOf(activity);
    const reference = activity.getConversationReference();
    const from = activity.from;
    const user =
      from?.id !== undefined ? { id: from.id, name: from.name } : undefined;

    // An Adaptive Card `Action.Submit` arrives as a Message activity carrying
    // our action `data` in `value` (and no user text). Route it as an
    // interaction so the engine resolves the matching `awaitChoice` waiter and
    // runs the button's `onClick` (which edits the picker card in place).
    const action = parseCardAction(activity);
    if (action) {
      const onInteraction = (replyContext: TurnContext): Promise<void> =>
        Promise.resolve(
          config.sink.onInteraction({
            id: action.id,
            conversationKey,
            value: action.value,
            user,
            replyTarget: {
              conversationKey,
              reference,
              context: replyContext,
            } satisfies TeamsSendTarget,
            messageRef: {
              id: activity.replyToId ?? "",
              conversationKey,
              reference,
              context: replyContext,
            },
          }),
        );

      if (this.canGoProactive()) {
        // Credentialed (real Teams): the inbound card-click turn's connector
        // client is created with an anonymous identity, so editing the card in
        // place (`updateActivity`, a PUT to the Connector) is rejected 401.
        // Run the interaction on a detached, app-id-authenticated proactive
        // context (exactly like an ordinary turn) and ack the click now.
        this.runDetached(reference, onInteraction);
      } else {
        // Anonymous local Playground: the inbound turn context is the only one
        // available (no app id for `continueConversation`) and works there.
        try {
          await onInteraction(context);
        } catch (err) {
          console.error("[bot-teams] interaction failed:", err);
        }
      }
      return;
    }

    // Ordinary chat message. Strip any `<at>bot</at>` mention (channel scope).
    let text = "";
    try {
      text = (activity.removeRecipientMention() ?? activity.text ?? "").trim();
    } catch {
      text = (activity.text ?? "").trim();
    }
    const { conversationKind, mentioned } = classifyConversation(activity);

    // Uploaded files (e.g. a CSV the user wants charted) ride along as
    // attachments. Download them and hand the model multimodal content parts.
    // Done inside `drive` (not before the ack) so a slow download never blocks
    // the inbound HTTP turn.
    const drive = async (target: TeamsSendTarget): Promise<void> => {
      // Keep "…is typing" visible for the whole turn. Teams' indicator expires
      // after a few seconds, and slow work (downloading a file, rendering a
      // chart) posts nothing in the meantime, so a one-shot ping leaves dead
      // air. Heartbeat until the run resolves.
      const stopTyping = this.startTypingHeartbeat(target);
      try {
        const { parts, notes } = await this.collectInboundFileParts(
          activity,
          config.files,
        );
        let contentParts: AgentContentPart[] | undefined;
        if (parts.length > 0) {
          contentParts = [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...parts,
            ...(notes.length
              ? [
                  {
                    type: "text" as const,
                    text: `[attachment notes: ${notes.join("; ")}]`,
                  },
                ]
              : []),
          ];
        }
        config.recordUser(conversationKey, contentParts ?? text);
        await config.sink.onTurn({
          conversationKey,
          replyTarget: target,
          userText: text,
          user,
          platform: "teams",
          contentParts,
          conversationKind,
          mentioned,
        });
      } finally {
        stopTyping();
      }
    };

    if (this.canGoProactive()) {
      this.runDetached(reference, (proactive) =>
        drive({ conversationKey, reference, context: proactive }),
      );
    } else {
      try {
        await drive({ conversationKey, reference, context });
      } catch (err) {
        console.error("[bot-teams] in-turn run failed:", err);
      }
    }
  }

  /**
   * Resolve a message's uploaded files into AG-UI content parts. Personal chats
   * deliver the file inline (the Teams bot file API, no credentials needed —
   * see `download-files.ts`); a channel doesn't include the file at all, so we
   * fetch it through Microsoft Graph (this connector's own app-only creds)
   * when configured. Failures are logged, never thrown.
   */
  private async collectInboundFileParts(
    activity: Activity,
    files: FileDeliveryConfig | undefined,
  ): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
    const attachments = (activity.attachments ?? []) as TeamsAttachmentRef[];
    const convType = (
      activity.conversation as { conversationType?: string } | undefined
    )?.conversationType;

    // Inline path (personal chat, or any direct file/media attachment) — no
    // credentials needed (the download URL is pre-authenticated by Teams).
    if (attachments.length > 0) {
      const result = await buildFileContentParts(attachments, files);
      this.logFileParts("attachment", result);
      if (result.parts.length > 0) return result;
    }

    // Channel path: the file lives in SharePoint, reachable only via Graph.
    if (convType === "channel") {
      const ref = this.channelMessageRef(activity);
      if (this.graphCreds && ref) {
        const result = await buildChannelFileContentParts(
          ref,
          this.graphCreds,
          files,
        );
        this.logFileParts("graph", result);
        return result;
      }
    }
    return { parts: [], notes: [] };
  }

  /** Pull the team/channel/message ids Graph needs out of a channel activity. */
  private channelMessageRef(activity: Activity): ChannelMessageRef | undefined {
    const cd = activity.channelData as
      | { team?: { aadGroupId?: string }; teamsChannelId?: string }
      | undefined;
    const teamId = cd?.team?.aadGroupId;
    const channelId = cd?.teamsChannelId;
    const messageId = activity.id;
    if (!teamId || !channelId || !messageId) return undefined;
    // conversation.id is "<channel>;messageid=<rootId>"; the root differs from
    // messageId only when the inbound message is a reply.
    const convId =
      (activity.conversation as { id?: string } | undefined)?.id ?? "";
    const rootId = convId.match(/messageid=(\d+)/)?.[1] ?? messageId;
    return { teamId, channelId, messageId, rootId };
  }

  /**
   * Concise operational log for the inbound-file pipeline: how many parts we
   * built and any skip reasons. Deliberately content-free — it never logs file
   * bytes, decoded text, or SharePoint URLs.
   */
  private logFileParts(
    source: string,
    result: { parts: AgentContentPart[]; notes: string[] },
  ): void {
    if (result.parts.length === 0 && result.notes.length === 0) return;
    console.log(
      `[bot-teams] ${source}: ${result.parts.length} file part(s)` +
        (result.notes.length ? `; notes: ${result.notes.join(" | ")}` : ""),
    );
  }

  /**
   * Send a typing indicator now and keep re-sending it every few seconds until
   * the returned stop fn is called. Teams' typing indicator lapses after a few
   * seconds, so a single ping can't cover slow work. Returns a stop fn; call it
   * in a `finally` so the timer is always cleared.
   */
  private startTypingHeartbeat(target: TeamsSendTarget): () => void {
    void this.sendTyping(target); // immediate, so the indicator shows right away
    const timer = setInterval(() => void this.sendTyping(target), 3500);
    return () => clearInterval(timer);
  }
}
