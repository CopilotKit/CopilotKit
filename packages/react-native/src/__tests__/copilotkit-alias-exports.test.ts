import { describe, it, expect } from "vitest";

import * as headlessEntry from "../headless";
import * as barrelEntry from "../index";

// `CopilotKit` is v1's name for the provider, kept as an alias of
// `CopilotKitProvider` to match `@copilotkit/react-core`. Both public entries
// must carry it as a runtime component, not a type-only re-export.
describe("react-native entries export the CopilotKit alias", () => {
  it.each([
    ["@copilotkit/react-native/headless", headlessEntry.CopilotKit],
    ["@copilotkit/react-native", barrelEntry.CopilotKit],
  ] as const)("%s exports CopilotKit as a component", (_entry, CopilotKit) => {
    expect(typeof CopilotKit).toBe("function");
  });
});
