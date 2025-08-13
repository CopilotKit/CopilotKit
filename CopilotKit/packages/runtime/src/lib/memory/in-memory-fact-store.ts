export type MemoryUpdateEvent = "fact.learned" | "fact.updated" | "fact.deleted";

export interface MemoryFact {
  key: string;
  value: unknown;
  confidence: number;
  decay?: number;
  provenance?: string;
  updatedAt?: number;
}

export interface MemoryFactStore<TFact extends MemoryFact = MemoryFact> {
  getHighConfidenceFacts(params: {
    publicApiKey: string;
    userId: string;
    minConfidence?: number;
  }): TFact[];

  upsert(params: {
    publicApiKey: string;
    userId: string;
    factKey: string;
    value: unknown;
    confidence?: number;
    provenance?: string;
  }): { fact: TFact; oldValue?: unknown; event: MemoryUpdateEvent };

  delete(params: { publicApiKey: string; userId: string; factKey: string }): {
    oldValue?: unknown;
    event: "fact.deleted";
  };
}

// Minimal non-durable store for dev/demos. Single-process only.
export class InMemoryFactStore implements MemoryFactStore {
  private store = new Map<string, MemoryFact>();

  private k(api: string, user: string, fact: string): string {
    return `${api}:${user}:${fact}`;
  }

  getHighConfidenceFacts({
    publicApiKey,
    userId,
    minConfidence = 0.7,
  }: {
    publicApiKey: string;
    userId: string;
    minConfidence?: number;
  }): MemoryFact[] {
    const prefix = `${publicApiKey}:${userId}:`;
    const out: MemoryFact[] = [];
    this.store.forEach((v, k) => {
      if (k.startsWith(prefix) && (v.confidence ?? 0) >= minConfidence) out.push(v);
    });
    return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  upsert({
    publicApiKey,
    userId,
    factKey,
    value,
    confidence = 0.9,
    provenance,
  }: {
    publicApiKey: string;
    userId: string;
    factKey: string;
    value: unknown;
    confidence?: number;
    provenance?: string;
  }) {
    console.log("upsert", { publicApiKey, userId, factKey, value, confidence, provenance });
    const now = Date.now();
    const key = this.k(publicApiKey, userId, factKey);
    const prev = this.store.get(key);
    const fact: MemoryFact = { key: factKey, value, confidence, provenance, updatedAt: now };
    this.store.set(key, fact);
    return { fact, oldValue: prev?.value, event: prev ? "fact.updated" : "fact.learned" } as const;
  }

  delete({
    publicApiKey,
    userId,
    factKey,
  }: {
    publicApiKey: string;
    userId: string;
    factKey: string;
  }) {
    const key = this.k(publicApiKey, userId, factKey);
    const prev = this.store.get(key);
    this.store.delete(key);
    return { oldValue: prev?.value, event: "fact.deleted" as const };
  }
}

export function createInMemoryFactStore() {
  return new InMemoryFactStore();
}
