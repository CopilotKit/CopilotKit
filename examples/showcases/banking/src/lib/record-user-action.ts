"use client";

/**
 * Self-learning recorder seam — the single import the teaching call sites use.
 *
 * Adapts the demo's call-site shape (`{ title, description, previousData,
 * newData, metadata }`) to the runtime hook
 * `useLearnFromUserActionInCurrentThread`, whose input is
 * `{ title?, description?, data?, occurredAt? }` (the hook the
 * `useRecordUserActionInCurrentThread` name was renamed to in PRs #4839/#5073).
 *
 * The before/after snapshots are nested under `data: { previous, next }` — the
 * shape the Intelligence "writer" agent distills into `/knowledge` — with any
 * extra `metadata` carried alongside. The hook sources `threadId` from the
 * surrounding `<CopilotChatConfigurationProvider>` (the chat panel), so call
 * sites only pass the semantic action and `.catch()` the returned promise.
 */
import { useCallback } from "react";
import { useLearnFromUserActionInCurrentThread } from "@copilotkit/react-core/v2";

export type UserActionRecord = {
  title: string;
  description: string;
  previousData?: unknown;
  newData?: unknown;
  metadata?: Record<string, unknown>;
};

export function useRecordUserActionInCurrentThread() {
  const learnFromUserAction = useLearnFromUserActionInCurrentThread();

  return useCallback(
    (record: UserActionRecord) =>
      learnFromUserAction({
        title: record.title,
        description: record.description,
        data: {
          previous: record.previousData ?? null,
          next: record.newData ?? null,
          ...(record.metadata ? { metadata: record.metadata } : {}),
        },
      }),
    [learnFromUserAction],
  );
}
