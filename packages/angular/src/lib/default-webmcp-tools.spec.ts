/**
 * The `defaultWebMCPTools` config. The registration rules themselves are
 * tested in `packages/core/src/core/__tests__/run-handler-webmcp.test.ts`;
 * this asserts that the setting reaches the core. Mirrors
 * `react-core/src/v2/providers/__tests__/CopilotKitProvider.defaultWebMCPTools.test.tsx`.
 */
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { provideCopilotKit } from "./config";
import type { CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";

function createCopilotKit(config: CopilotKitConfig = {}): CopilotKit {
  TestBed.configureTestingModule({
    providers: [provideCopilotKit(config)],
  });
  return TestBed.inject(CopilotKit);
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe("provideCopilotKit defaultWebMCPTools", () => {
  it("is on by default", () => {
    expect(createCopilotKit().core.defaultWebMCPTools).toBe(true);
  });

  it("can be turned off", () => {
    expect(
      createCopilotKit({ defaultWebMCPTools: false }).core.defaultWebMCPTools,
    ).toBe(false);
  });
});
