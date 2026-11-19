import {
  GenerativeUIHostContext,
  useGenerativeUIHost,
} from "@copilotkit/react-core/v2/generative-ui/native";
import { useMemo } from "react";
import type { ReactNode } from "react";

const NoFallback = () => null;

/**
 * A part the agent got wrong (an unknown component, invalid props, a cyclic
 * reference) is left out of the view rather than shown as an error box.
 * `errorBoundary.fallback` covers parts that throw while rendering; the
 * host's `NodeFallback` covers the rest.
 */
export function QuietNodeFallbacks({ children }: { children: ReactNode }) {
  const host = useGenerativeUIHost();
  const quiet = useMemo(() => ({ ...host, NodeFallback: NoFallback }), [host]);
  return (
    <GenerativeUIHostContext.Provider value={quiet}>
      {children}
    </GenerativeUIHostContext.Provider>
  );
}
