export type MaybePromise<T> = T | PromiseLike<T>;

/**
 * More specific utility for records with at least one key
 */
export type NonEmptyRecord<T> =
  T extends Record<string, unknown>
    ? keyof T extends never
      ? never
      : T
    : never;

/**
 * Type representing an agent's basic information
 */
export interface AgentDescription {
  name: string;
  className: string;
  description: string;
}

export interface RuntimeInfo {
  version: string;
  agents: Record<string, AgentDescription>;
  audioFileTranscriptionEnabled: boolean;
  /** List of middleware names enabled in the runtime (e.g. "a2ui", "mcp") */
  middleware?: string[];
}
