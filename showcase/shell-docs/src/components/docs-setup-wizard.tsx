// docs-setup-wizard.tsx — the server-side boundary between the docs
// registry and the setup wizard.
//
// `SetupWizard` is marked for the client, and the docs registry it needs
// data from is large enough (~646 KB) that importing it from client code
// would ship the whole registry to the browser. This file exists so that
// never happens again: it is the only module that reads
// `@/lib/homepage-map`, and it does nothing else — it stays a plain server
// module. Docs-only partner roots add their fixed choice here.
// Ordering and filtering are `homepage-map.ts`'s decisions, guarded by that
// module's own tests.
import React from "react";
import { SetupWizard } from "@/components/setup-wizard";
import {
  agentPicks,
  frontendPicks,
  COPILOTKIT_CAPABILITIES,
} from "@/lib/homepage-map";

export function DocsSetupWizard({
  backend,
  frontend,
}: { backend?: string; frontend?: string } = {}): React.JSX.Element {
  const backends = agentPicks();
  const docsOnlyNames: Record<string, string> = {
    a2a: "A2A",
    "agent-spec": "Agent Spec",
  };
  if (
    backend &&
    docsOnlyNames[backend] &&
    !backends.some((pick) => pick.id === backend)
  ) {
    backends.push({
      id: backend,
      name: docsOnlyNames[backend],
      logo: { kind: "framework", slug: backend },
    });
  }
  return (
    <SetupWizard
      fixedBackend={backend}
      defaultFrontend={frontend}
      frontends={frontendPicks()}
      capabilities={COPILOTKIT_CAPABILITIES}
      backends={backends}
    />
  );
}
