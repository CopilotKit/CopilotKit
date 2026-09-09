// docs-setup-wizard.tsx — the server-side boundary between the docs
// registry and the setup wizard.
//
// `SetupWizard` is marked for the client, and the docs registry it needs
// data from is large enough (~646 KB) that importing it from client code
// would ship the whole registry to the browser. This file exists so that
// never happens again: it is the only module that reads
// `@/lib/homepage-map`, and it does nothing else — it stays a plain server
// module, and it does not transform, re-sort, or re-filter anything.
// Ordering and filtering are `homepage-map.ts`'s decisions, guarded by that
// module's own tests.
import React from "react";
import { SetupWizard } from "@/components/setup-wizard";
import {
  agentPicks,
  frontendPicks,
  COPILOTKIT_CAPABILITIES,
} from "@/lib/homepage-map";

export function DocsSetupWizard(): React.JSX.Element {
  return (
    <SetupWizard
      frontends={frontendPicks()}
      capabilities={COPILOTKIT_CAPABILITIES}
      backends={agentPicks()}
    />
  );
}
