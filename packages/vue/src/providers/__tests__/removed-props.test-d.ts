// Type-only assertions, never executed: 2.0 types the props of the 1.x
// <CopilotKit> as never, so that 1.x code fails the type check.
import { describe, it } from "vitest";
import type { CopilotKitProviderProps } from "../CopilotKitProvider.types";

/** Takes the props of the provider, as a template or `h()` does. */
function provider(props: CopilotKitProviderProps) {
  return props;
}

describe("the props of the 1.x <CopilotKit>", () => {
  it("fail the type check", () => {
    // @ts-expect-error -- 2.0 types the 1.x prop as never
    provider({ threadId: "thread-1" });
    // @ts-expect-error -- 2.0 types the 1.x prop as never
    provider({ showDevConsole: true });
    // The props of 2.0 pass.
    provider({
      runtimeUrl: "/api/copilotkit",
      headers: { Authorization: "Bearer token" },
    });
  });
});
