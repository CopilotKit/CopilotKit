import { randomUUID } from "node:crypto";
import type { BaseEvent } from "@ag-ui/client";
import { createClient } from "redis";

const TOKEN_TTL_SECONDS = 30;
const THREAD_HISTORY_TTL_SECONDS = 60 * 60 * 24;
const MAX_THREAD_HISTORY_EVENTS = 500;
const LOCK_TTL_SECONDS = 60 * 5;

type TokenMetadata = {
  threadId: string;
  agentId: string;
  issuedAt: number;
};

export class RealtimeStore {
  constructor(private readonly redis: any) {}

  static async create(redisUrl: string): Promise<RealtimeStore> {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    return new RealtimeStore(redis);
  }

  async close() {
    await this.redis.quit();
  }

  async acquireThreadLock(threadId: string, runId: string): Promise<boolean> {
    const result = await this.redis.set(this.lockKey(threadId), runId, {
      NX: true,
      EX: LOCK_TTL_SECONDS,
    });
    return result === "OK";
  }

  async releaseThreadLock(threadId: string, runId?: string): Promise<void> {
    if (!runId) {
      await this.redis.del(this.lockKey(threadId));
      return;
    }

    await this.redis.eval(
      `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
      `,
      {
        keys: [this.lockKey(threadId)],
        arguments: [runId],
      },
    );
  }

  async issueToken(params: {
    agentId: string;
    threadId: string;
    replayEvents?: BaseEvent[];
  }) {
    const token = randomUUID();
    const metadata: TokenMetadata = {
      threadId: params.threadId,
      agentId: params.agentId,
      issuedAt: Date.now(),
    };

    await this.redis.set(this.tokenKey(token), JSON.stringify(metadata), {
      EX: TOKEN_TTL_SECONDS,
    });
    await this.redis.set(
      this.tokenReplayKey(token),
      JSON.stringify(params.replayEvents ?? []),
      {
        EX: TOKEN_TTL_SECONDS,
      },
    );

    return {
      token,
      expiresInSeconds: TOKEN_TTL_SECONDS,
      threadId: params.threadId,
    };
  }

  async appendTokenReplay(token: string, event: BaseEvent): Promise<void> {
    const replay = await this.getTokenReplay(token);
    replay.push(event);
    await this.redis.set(this.tokenReplayKey(token), JSON.stringify(replay), {
      EX: TOKEN_TTL_SECONDS,
    });
  }

  async getTokenReplay(token: string): Promise<BaseEvent[]> {
    const payload = await this.redis.get(this.tokenReplayKey(token));
    if (!payload) {
      return [];
    }

    try {
      const parsed = JSON.parse(payload) as BaseEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async appendThreadEvent(threadId: string, event: BaseEvent): Promise<void> {
    const history = await this.getThreadEvents(threadId);
    history.push(event);

    const compacted = history.slice(-MAX_THREAD_HISTORY_EVENTS);
    await this.redis.set(this.threadEventsKey(threadId), JSON.stringify(compacted), {
      EX: THREAD_HISTORY_TTL_SECONDS,
    });

    await this.redis.publish(
      this.threadPubsubChannel(threadId),
      JSON.stringify({ threadId, event }),
    );
  }

  async getThreadEvents(threadId: string): Promise<BaseEvent[]> {
    const payload = await this.redis.get(this.threadEventsKey(threadId));
    if (!payload) {
      return [];
    }

    try {
      const parsed = JSON.parse(payload) as BaseEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  tokenKey(token: string) {
    return `ck:token:${token}`;
  }

  tokenReplayKey(token: string) {
    return `ck:token-replay:${token}`;
  }

  threadEventsKey(threadId: string) {
    return `ck:thread:${threadId}:events`;
  }

  threadPubsubChannel(threadId: string) {
    return `ck:thread:${threadId}:pubsub`;
  }

  private lockKey(threadId: string) {
    return `ck:thread:${threadId}:lock`;
  }
}
