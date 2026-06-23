import { describe, expect, it } from "vitest";
import { CopilotChatDefaultLabels as DefaultLabelsFromProvider } from "../CopilotChatConfigurationProvider";
import { CopilotChatDefaultLabels as DefaultLabelsFromBarrel } from "../../index";

// Regression guard: the public web barrel (`@copilotkit/react-core/v2`,
// `src/v2/index.ts`) re-exports `./providers`, so the runtime value
// `CopilotChatDefaultLabels` must flow through `providers/index.ts` for web
// consumers to spread/override the default labels. The headless entrypoint
// (`src/v2/headless.ts`) already exports it for react-native; this asserts the
// web barrel exposes the same value.
describe("CopilotChatDefaultLabels barrel re-export", () => {
  it("is exposed from the v2 web barrel", () => {
    expect(DefaultLabelsFromBarrel).toBeDefined();
  });

  it("is the same value re-exported by CopilotChatConfigurationProvider", () => {
    expect(DefaultLabelsFromBarrel).toBe(DefaultLabelsFromProvider);
  });
});
