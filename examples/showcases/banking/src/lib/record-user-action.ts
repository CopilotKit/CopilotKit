/**
 * No-op recorder shim.
 *
 * The self-learning loop needs demonstrated officer actions streamed to the
 * Intelligence "writer" agent so they can be distilled into `/knowledge`. The
 * intended client API for that is a `useRecordUserActionInCurrentThread` hook
 * exported from `@copilotkit/react-core/v2`.
 *
 * VERIFIED GAP (Phase C, 2026-06-03): that hook does NOT exist in this OSS
 * `@copilotkit/react-core/v2` build, and is also absent from the local
 * Intelligence repo at /Users/jerel-cpk/Projects/cpk-intelligence (searched by
 * name across both). The OSS react-core/v2 hooks index exports only
 * useFrontendTool / useHumanInTheLoop / useAgent / useThreads / etc. — there is
 * no client-side "record user action" mechanism to call, even when the runtime
 * is wired to a `CopilotKitIntelligence` backend (server route.ts, Phase C).
 *
 * This shim keeps the teaching-surface call sites identical to what the real
 * recording API would look like (they call `recordUserAction({...}).catch(...)`
 * exactly the same way) while recording nothing. When a real
 * `useRecordUserActionInCurrentThread` (or equivalent client method) ships in a
 * react-core build the demo can depend on, swap this import for it — the call
 * sites in policy-exception-modal.tsx and transactions-list.tsx need no change.
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
