"use client";

import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { PeopleLedgerProvider, usePeopleLedger } from "./data/ledger-context";
import { RecordingProvider, RecordingVignette } from "@/shell/teach";
import { setSandboxSnapshot } from "./sandbox-functions";

/**
 * Rowan uses BOTH provider slots the contract offers, and the split matters.
 *
 * `RuntimeProviders` mounts ABOVE `CopilotKitProvider`. The ledger lives here
 * because `useRuntimeProperties` reads the signed-in operator out of it, and
 * `properties` is a PROP of `CopilotKitProvider` — so its source has to exist
 * before that provider's first commit. A child racing an imperative
 * `setProperties` after mount is precisely the bug this slot exists to prevent.
 * Mounting above also means everything below (Tools, layout, pages) shares the
 * one ledger fetch.
 *
 * `Providers` mounts BELOW it, for anything that consumes CopilotKit context —
 * here, the teach-mode recording context and its canvas-edge vignette. Both come
 * from the shell's `@/shell/teach`, the ONE implementation; the vignette styles
 * itself from this skin's `--brand-violet` / `--brand-indigo` tokens, so there is
 * no per-skin copy of either the state machine or the keyframes.
 */

/** Above CopilotKitProvider. */
export function PeopleRuntimeProviders({ children }: { children: ReactNode }) {
  return <PeopleLedgerProvider>{children}</PeopleLedgerProvider>;
}

/**
 * Threaded into `CopilotKitProvider`'s `properties` prop by the shell, and
 * forwarded to the server as the run body's forwardedProps, where
 * `peopleIdentifyUser` maps it onto a durable-memory scope.
 *
 * Memoized on the two primitive fields rather than the operator object: the
 * ledger re-creates that object on every refresh, and an unstable `properties`
 * identity would re-scope the run on every mutation.
 *
 * Deliberately does NOT set `a2uiCatalogAvailable` — the shell adds that itself
 * when a catalog is present.
 */
export function usePeopleRuntimeProperties():
  | Record<string, unknown>
  | undefined {
  const { operator } = usePeopleLedger();
  return useMemo(
    () => ({ userId: operator.id, userRole: operator.role }),
    [operator.id, operator.role],
  );
}

/**
 * Keeps the module-scope snapshot the OGUI sandbox functions read in sync with
 * the live ledger. Renders nothing. Without it those functions answer from an
 * empty ledger and generated UI comes back convincingly blank.
 */
function SandboxDataSync() {
  const { data } = usePeopleLedger();
  useEffect(() => {
    setSandboxSnapshot(data);
  }, [data]);
  return null;
}

/** Below CopilotKitProvider. */
export function PeopleProviders({ children }: { children: ReactNode }) {
  return (
    <RecordingProvider>
      <SandboxDataSync />
      {children}
      <RecordingVignette />
    </RecordingProvider>
  );
}
