"use client";

import { useEffect } from "react";
import { useLogistics } from "./actions";
import { setSandboxSnapshot } from "./sandbox-functions";

/**
 * Mirrors the live ledger into the OGUI sandbox snapshot. Renders null.
 * Mounted in the skin's `Providers` (below CopilotKitProvider) so a generated
 * UI always reads the same data the app is showing.
 */
export function SandboxDataSync() {
  const { shipments, lanes, inventory } = useLogistics();
  useEffect(() => {
    setSandboxSnapshot({ shipments, lanes, inventory });
  }, [shipments, lanes, inventory]);
  return null;
}

export default SandboxDataSync;
