import type { StateStore } from "./state/state-store.js";
import { parseDuration } from "./state/duration.js";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  platform: string;
  threadId: string;
  userId: string;
  ts: number;
}

export interface TranscriptsConfig {
  retention?: string | number;
  maxPerUser?: number;
}

const keyFor = (userId: string) => `transcript:user:${userId}`;

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
   * No-ops silently when no canonical application user ID is supplied.
   */
  async append(
    thread: { platform: string; conversationKey: string },
    msg: { role?: "user" | "assistant"; text: string },
    opts: { userId: string | null },
  ): Promise<void> {
    const userId = opts.userId;
    if (!userId) return; // identity unresolved → no-op
    const entry: TranscriptEntry = {
      role: msg.role ?? "user",
      text: msg.text,
      platform: thread.platform,
      threadId: thread.conversationKey,
      userId,
      ts: Date.now(),
    };
    await this.state.list.append(keyFor(userId), entry, {
      maxLen: this.cfg.maxPerUser,
      ttlMs: this.retentionMs,
    });
    if (this.retentionMs !== undefined) {
      const cutoff = Date.now() - this.retentionMs;
      const all = await this.state.list.range<TranscriptEntry>(keyFor(userId));
      const expired = all.filter((e) => e.ts < cutoff).length;
      if (expired > 0) {
        const survivors = all.length - expired;
        if (survivors <= 0) await this.state.list.delete(keyFor(userId));
        else await this.state.list.trim(keyFor(userId), survivors);
      }
    }
  }

  async list(q: {
    userId: string;
    limit?: number;
    platforms?: string[];
    threadId?: string;
    roles?: ("user" | "assistant")[];
  }): Promise<TranscriptEntry[]> {
    let items = await this.state.list.range<TranscriptEntry>(keyFor(q.userId));
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

  async delete(q: { userId: string }): Promise<{ deleted: number }> {
    const n = (await this.state.list.range(keyFor(q.userId))).length;
    await this.state.list.delete(keyFor(q.userId));
    return { deleted: n };
  }
}
