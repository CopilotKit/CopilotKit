import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CopilotKit } from "./copilotkit";
import { registerRenderActivityMessage } from "./activity-renderer";
import type { RenderActivityMessageConfig } from "./activity-renderer";

describe("registerRenderActivityMessage", () => {
  it("registers in the injection context and removes the same config on destroy", () => {
    const addRenderActivityMessage = vi.fn();
    const removeRenderActivityMessage = vi.fn();
    const config = { activityType: "example" } as RenderActivityMessageConfig;

    const injector = createEnvironmentInjector(
      [
        {
          provide: CopilotKit,
          useValue: { addRenderActivityMessage, removeRenderActivityMessage },
        },
      ],
      TestBed.inject(EnvironmentInjector),
    );

    runInInjectionContext(injector, () =>
      registerRenderActivityMessage(config),
    );

    expect(addRenderActivityMessage).toHaveBeenCalledWith(config);
    injector.destroy();
    expect(removeRenderActivityMessage).toHaveBeenCalledWith(config);
  });
});
