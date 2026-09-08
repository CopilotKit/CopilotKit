import { signal } from "@angular/core";
import { describe, expect, it } from "vitest";

import { createBackgroundTool } from "./tool-feature-model";

describe("background frontend tool", () => {
  it("preserves the default follow-up run", () => {
    expect(createBackgroundTool(signal("initial"))).not.toHaveProperty(
      "followUp",
    );
  });
});
