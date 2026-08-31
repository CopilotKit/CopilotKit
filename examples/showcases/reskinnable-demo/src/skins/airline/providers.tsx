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
 *    commerce mount. Beat 6's chat card (`tools.tsx`'s `DemonstrationCard`) holds
 *    the outer bracket open while `components/fare-exception-form.tsx` nests its
 *    own inside it, and the vignette is the room's signal that recording is live.
 *
 * STILL NOT `RuntimeProviders`, even though Aeronova now DOES contribute runtime
 * `properties` and a server `identifyUser`. The other four scoped skins hoist a
 * context above `CopilotKitProvider` because their identity is a CHOICE an operator
 * makes in the sidebar, so their hook has to read state. Aeronova has one account
 * holder and no switcher — `useAirlineRuntimeProperties` returns a frozen module
 * constant and reads no context at all (see `runtime-properties.ts`), so there is
 * nothing for a provider above the runtime to establish. If a "book for someone
 * else" mode ever lands, the ledger provider is what moves up, because that is
 * where the chosen traveller would be read from.
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
