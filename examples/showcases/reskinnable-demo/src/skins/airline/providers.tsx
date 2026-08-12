"use client";

import type { ReactNode } from "react";
import { RecordingProvider, RecordingVignette } from "@/shell/teach";
import { AirlineLedgerProvider } from "./ledger-context";

/**
 * Aeronova's provider stack, mounted BELOW `CopilotKitProvider` as
 * `skin.Providers`.
 *
 * TWO things live here, and the order matters only in one direction: the ledger
 * has to wrap everything that reads it (Tools, the layout chrome, every page),
 * which the shell guarantees by mounting `Providers` above all three.
 *
 *  - `AirlineLedgerProvider` — ONE `GET /ledger` read, shared. Aeronova
 *    publishes a single cross-cutting snapshot rather than per-collection
 *    endpoints, and beat 3b asks the agent to describe exactly what the
 *    passenger can see, so two panels disagreeing about the ledger is the one
 *    failure this must not have. See `ledger-context.tsx`.
 *  - `RecordingProvider` + `RecordingVignette` — the shell's ONE teach-mode
 *    recorder (`@/shell/teach`), the same implementation banking, people and
 *    commerce mount. It is inert until something calls `useRecording()`, so
 *    mounting it now costs nothing and means the slot that lands Aeronova's
 *    teach loop touches `tools.tsx` only.
 *
 * NOT `RuntimeProviders`. Airline contributes no runtime `properties` today —
 * there is no `useRuntimeProperties` and no server `identifyUser` for this skin
 * — so nothing here has to exist above `CopilotKitProvider`. If per-passenger
 * memory scoping is added later, the ledger provider is what moves up, because
 * that is where the traveller identity would be read from.
 */
export function AirlineProviders({ children }: { children: ReactNode }) {
  return (
    <AirlineLedgerProvider>
      <RecordingProvider>
        {children}
        <RecordingVignette />
      </RecordingProvider>
    </AirlineLedgerProvider>
  );
}

export default AirlineProviders;
