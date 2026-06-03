/**
 * No-op recorder shim.
 *
 * The Intelligence build ships `useRecordUserActionInCurrentThread` from
 * `@copilotkit/react-core/v2`, which streams demonstrated officer actions to
 * the self-learning writer agent. This OSS showcase has no
 * `CopilotKitIntelligence` runtime, so the hook does not exist here. This shim
 * keeps the teaching-surface call sites identical to the Intelligence version
 * (they call `recordUserAction({...}).catch(...)` exactly the same way) while
 * recording nothing. Swap this import for the real react-core/v2 hook once a
 * `CopilotKitIntelligence` runtime is wired (Phase C).
 */

export type UserActionRecord = {
  title: string;
  description: string;
  previousData?: unknown;
  newData?: unknown;
  metadata?: Record<string, unknown>;
};

export const useRecordUserActionInCurrentThread =
  () =>
  (record: UserActionRecord): Promise<void> => {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[sl:record]", record.title, record);
    }
    return Promise.resolve();
  };
