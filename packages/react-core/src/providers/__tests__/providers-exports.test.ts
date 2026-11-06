import { describe, it, expect } from "vitest";
import * as providers from "../index";

// `src/providers/index.ts` enumerates its exports by name rather than
// re-exporting `*`, so a hook can exist, be re-exported by CopilotKitProvider.tsx,
// and still never reach `@copilotkit/react-core`. That is how
// `useLicenseContext` went missing from the public entry: the only path that
// exposed it was `@copilotkit/react-core/context`, which (before the build
// was fixed to externalize the context module) served an orphaned copy that no
// provider ever populated.
//
// Typing the list as `(keyof typeof providers)[]` also fails `tsc` if one of
// these is removed, so the surface is guarded at build time too.
describe("@copilotkit/react-core provider entry exports", () => {
  it("exports the provider hooks as runtime functions", () => {
    const hooks: (keyof typeof providers)[] = [
      "useCopilotKit",
      "useLicenseContext",
      "useCopilotChatConfiguration",
      "useSandboxFunctions",
    ];
    for (const name of hooks) {
      expect(
        typeof providers[name],
        `${name} should be exported as a runtime function`,
      ).toBe("function");
    }
  });

  it("exports the providers themselves", () => {
    const values: (keyof typeof providers)[] = [
      "CopilotKitProvider",
      "CopilotChatConfigurationProvider",
      "SandboxFunctionsContext",
    ];
    for (const name of values) {
      expect(providers[name], `${name} should be exported`).toBeDefined();
    }
  });
});
