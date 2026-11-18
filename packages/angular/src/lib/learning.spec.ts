import { EnvironmentInjector, PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { provideCopilotKit, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";

const sinkLearning = {
  sink: () => {},
  capture: { clicks: false, navigation: false, network: false },
};

function inject(
  config: CopilotKitConfig,
  platformId: "browser" | "server" = "browser",
) {
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit(config),
      { provide: PLATFORM_ID, useValue: platformId },
    ],
  });
  return TestBed.inject(CopilotKit);
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe("CopilotKit learning option", () => {
  it("starts a Trajectory with a generated ID in the browser", () => {
    const { core } = inject({ learning: sinkLearning });

    expect(core.ɵlearningConfigured).toBe(true);
    expect(core.trajectoryId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("starts with a supplied trajectoryId", () => {
    const { core } = inject({
      learning: { ...sinkLearning, trajectoryId: "angular-trajectory" },
    });

    expect(core.trajectoryId).toBe("angular-trajectory");
  });

  it("configures capture without starting it when autoStart is false", () => {
    const { core } = inject({
      learning: { ...sinkLearning, autoStart: false },
    });

    expect(core.ɵlearningConfigured).toBe(true);
    expect(core.trajectoryId).toBeNull();
  });

  it("does nothing without the option or during server rendering", () => {
    expect(inject({}).core.ɵlearningConfigured).toBe(false);

    TestBed.resetTestingModule();
    expect(
      inject({ learning: sinkLearning }, "server").core.ɵlearningConfigured,
    ).toBe(false);
  });

  it("stops capture when the application is destroyed", () => {
    const { core } = inject({ learning: sinkLearning });

    TestBed.inject(EnvironmentInjector).destroy();

    expect(core.trajectoryId).toBeNull();
  });
});
