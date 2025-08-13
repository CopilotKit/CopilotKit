export interface MemoryFact {
  key: string;
  value: unknown;
  confidence: number; // 0..1
  decay?: number;
  provenance?: string;
  updatedAt?: string | Date;
}

export type MemoryUpdateEvent = "fact.learned" | "fact.updated" | "fact.deleted";

export type MemoryUpdateReason =
  | "explicit_user_request"
  | "implicit_preference_inference"
  | "tool_output"
  | "system_policy"
  | (string & {});

export interface MemoryUpdateMessage {
  type: "memory_update";
  fact_key: string;
  old_value?: unknown;
  new_value?: unknown;
  confidence: number; // 0..1
  reason: MemoryUpdateReason;
  event?: MemoryUpdateEvent;
  metadata?: {
    decay?: number;
    provenance?: string;
    userId?: string;
    publicApiKey?: string;
    threadId?: string;
    runId?: string;
  };
  id?: string;
  createdAt?: string | Date;
  role?: "assistant";
}

export function isMemoryUpdateMessage(x: any): x is MemoryUpdateMessage {
  return x?.type === "memory_update" && typeof x?.fact_key === "string";
}

export interface MemoryFactStore<TFact extends MemoryFact = MemoryFact> {
  getHighConfidenceFacts(params: {
    publicApiKey: string;
    userId: string;
    minConfidence?: number;
  }): Promise<TFact[]> | TFact[];

  upsert(params: {
    publicApiKey: string;
    userId: string;
    factKey: string;
    value: unknown;
    confidence?: number;
    provenance?: string;
  }):
    | Promise<{ fact: TFact; oldValue?: unknown; event: MemoryUpdateEvent }>
    | {
        fact: TFact;
        oldValue?: unknown;
        event: MemoryUpdateEvent;
      };

  delete(params: { publicApiKey: string; userId: string; factKey: string }):
    | Promise<{ oldValue?: unknown; event: "fact.deleted" }>
    | {
        oldValue?: unknown;
        event: "fact.deleted";
      };
}

export const COPILOT_USER_ID_HEADER = "X-Custom-User-Id";
export const COPILOT_USER_ID_PROPERTY = "user_id";
