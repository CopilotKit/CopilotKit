import type { StateStore } from "./state/state-store.js";
import { parseDuration } from "./state/duration.js";
import type { PlatformUser, IncomingMessage } from "@copilotkit/channels-ui";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  platform: string;
  threadId: string;
  userKey: string;
  ts: number;
}

export type Identity = (ctx: {
  adapter: string;
  author: PlatformUser;
  message: IncomingMessage;
}) => string | null | Promise<string | null>;

export interface TranscriptsConfig {
  retention?: string | number;
  maxPerUser?: number;
}

const keyFor = (userKey: string) => `transcript:user:${userKey}`;

export class Transcripts {
  private readonly retentionMs: number | undefined;

  constructor(
    private state: StateStore,
    private cfg: TranscriptsConfig = {},
  ) {
    this.retentionMs =
      cfg.retention !== undefined ? parseDuration(cfg.retention) : undefined;
  }

  /**
   * Append a message to the user's transcript.
   * No-ops silently when no `userKey` is resolved (from `opts.userKey` or `msg.userKey`).
   */
  async append(
    thread: { platform: string; conversationKey: string },
    msg: { role?: "user" | "assistant"; text: string; userKey?: string },
    opts?: { userKey?: string },
  ): Promise<void> {
    const userKey = opts?.userKey ?? msg.userKey;
    if (!userKey) return; // identity unresolved → no-op
    const entry: TranscriptEntry = {
      role: msg.role ?? "user",
      text: msg.text,
      platform: thread.platform,
      threadId: thread.conversationKey,
      userKey,
      ts: Date.now(),
    };
    await this.state.list.append(keyFor(userKey), entry, {
      maxLen: this.cfg.maxPerUser,
      ttlMs: this.retentionMs,
    });
    if (this.retentionMs !== undefined) {
      const cutoff = Date.now() - this.retentionMs;
      const all = await this.state.list.range<TranscriptEntry>(keyFor(userKey));
      const expired = all.filter((e) => e.ts < cutoff).length;
      if (expired > 0) {
        const survivors = all.length - expired;
        if (survivors <= 0) await this.state.list.delete(keyFor(userKey));
        else await this.state.list.trim(keyFor(userKey), survivors);
      }
    }
  }

  async list(q: {
    userKey: string;
    limit?: number;
    platforms?: string[];
    threadId?: string;
    roles?: ("user" | "assistant")[];
  }): Promise<TranscriptEntry[]> {
    let items = await this.state.list.range<TranscriptEntry>(keyFor(q.userKey));
    if (this.retentionMs !== undefined) {
      const cutoff = Date.now() - this.retentionMs;
      items = items.filter((e) => e.ts >= cutoff);
    }
    if (q.platforms)
      items = items.filter((e) => q.platforms!.includes(e.platform));
    if (q.threadId) items = items.filter((e) => e.threadId === q.threadId);
    if (q.roles) items = items.filter((e) => q.roles!.includes(e.role));
    if (q.limit !== undefined) items = items.slice(-q.limit);
    return items; // oldest-first
  }

  async delete(q: { userKey: string }): Promise<{ deleted: number }> {
    const n = (await this.state.list.range(keyFor(q.userKey))).length;
    await this.state.list.delete(keyFor(q.userKey));
    return { deleted: n };
  }
}
