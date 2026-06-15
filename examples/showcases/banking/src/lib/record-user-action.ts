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
 * sites only pass the semantic action. Recording is best-effort: this seam
 * swallows failures internally (it is a no-op without an Intelligence backend),
 * so call sites never need to guard the returned promise.
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
      }).catch((error: unknown) => {
        // Recording is best-effort: it only persists against an Intelligence
        // backend, and in OSS mode the annotate endpoint returns 422. Swallow
        // the failure here — logged quietly via console.debug, NOT
        // console.error — so a missing backend never raises an unhandled
        // rejection or a Next.js dev error overlay mid-demo. In Intelligence
        // mode this resolves normally and records as before.
        console.debug(
          "[self-learning] recordUserAction skipped:",
          error instanceof Error ? error.message : error,
        );
      }),
    [learnFromUserAction],
  );
}
