/**
 * A Proxy-backed module namespace for `@copilotkit/react-core/v2` that routes
 * a small subset of exports to the real v2 package (the ones Plan #3 needs for
 * live runtime chat) and falls through to capture-only stubs for everything
 * else — preserving Plan #2's TDZ-avoidance strategy for the chat UI / markdown
 * / runtime-client-gql surface we don't need.
 *
 * Known-real exports in Plan #3 (v2-only hooks):
 *   - CopilotKitProvider  (connects to runtime — the v2 provider)
 *   - CopilotKit          (v1 backward-compat alias re-exported from v2)
 *   - useFrontendTool     (v2 frontend tool registration)
 *
 * Note: useCopilotAction, useCopilotReadable, and useCopilotChat are v1 hooks
 * and are NOT exported from @copilotkit/react-core/v2. They remain capture-only
 * stubs. Plan #4 expands the real surface as chat UI lands.
 *
 * Using explicit named imports (not `import * as`) to avoid triggering rolldown's
 * namespace-walk, which would pull the entire transitive CJS dep graph and
 * risk TDZ errors from the chat/runtime-client-gql packages.
 */
import {
  CopilotKit,
  CopilotKitProvider,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { createCopilotkitStubs } from "../hook-preview/copilotkit-stubs";

const REAL: Record<string, unknown> = {
  CopilotKit,
  CopilotKitProvider,
  useFrontendTool,
};

export function createForwardingStubs(): Record<string, unknown> {
  const fallback = createCopilotkitStubs();
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop in REAL) return REAL[prop];
        return (fallback as Record<string, unknown>)[prop];
      },
      has() {
        return true;
      },
    },
  );
}
