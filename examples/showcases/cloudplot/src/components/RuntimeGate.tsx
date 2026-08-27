import { cookies } from "next/headers";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

import {
  SESSION_COOKIE_NAME,
  getRuntimeSecurityConfiguration,
  verifySessionValue,
} from "../lib/runtimeSecurity";
import { AccessGate } from "./AccessGate";

export async function RuntimeGate({ children }: { children: React.ReactNode }) {
  const configuration = getRuntimeSecurityConfiguration();
  if (configuration.mode === "misconfigured") {
    return <AccessGate configurationError />;
  }
  if (configuration.mode === "protected") {
    const session = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!verifySessionValue(session, configuration)) return <AccessGate />;
  }

  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
    </CopilotKitProvider>
  );
}
