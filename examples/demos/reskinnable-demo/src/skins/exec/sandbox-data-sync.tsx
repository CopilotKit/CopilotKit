"use client";

import { useEffect } from "react";
import { useExecLedger } from "@/skins/exec/data/ledger-context";
import { setSandboxSnapshot } from "@/skins/exec/sandbox-functions";

/**
 * Mirrors the live ledger snapshot into the OGUI sandbox's module-scope state
 * so the iframe's `getMetricSeries` / `getExceptions` callbacks answer from
 * the exact data the app is showing, not the empty seed `sandbox-functions.ts`
 * starts with. Renders nothing. Mirrors banking's separate-file
 * `sandbox-data-sync.tsx` (`src/skins/banking/sandbox-data-sync.tsx`) rather
 * than people's inlined version, since exec's sync source is a hook
 * (`useExecLedger`) rather than a same-file ledger read.
 *
 * `snapshot` is `ExecLedgerSnapshot` — `LedgerSnapshot` with each dashboard's
 * blocks widened by an extra `ops` field. `setSandboxSnapshot` only reads
 * `points` and `exceptions`, so the wider shape passes through untouched.
 */
export function SandboxDataSync() {
  const { snapshot } = useExecLedger();
  useEffect(() => {
    setSandboxSnapshot(snapshot);
  }, [snapshot]);
  return null;
}
