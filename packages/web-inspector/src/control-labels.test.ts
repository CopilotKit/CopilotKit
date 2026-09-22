import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  INSPECTOR_LEARNING_LABEL,
  INSPECTOR_THREADS_LABEL,
} from "./control-labels.js";

describe("inspector control labels", () => {
  it("uses one shared string for the threads and learning controls", () => {
    const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    const learningView = readFileSync(
      join(import.meta.dirname, "components", "learning-view.ts"),
      "utf8",
    );
    const homeBriefing = readFileSync(
      join(import.meta.dirname, "lib", "home-briefing.ts"),
      "utf8",
    );

    expect(INSPECTOR_THREADS_LABEL).toBe("Threads");
    expect(INSPECTOR_LEARNING_LABEL).toBe("Learning");
    expect(source).toContain("INSPECTOR_THREADS_LABEL");
    expect(source).toContain("INSPECTOR_LEARNING_LABEL");
    expect(learningView).toContain("INSPECTOR_THREADS_LABEL");
    expect(learningView).toContain("INSPECTOR_LEARNING_LABEL");
    expect(homeBriefing).toContain("INSPECTOR_THREADS_LABEL");
    expect(homeBriefing).toContain("INSPECTOR_LEARNING_LABEL");
    expect(source).not.toContain("Rich Threads");
    expect(source).not.toContain("Automatic Learning");
    expect(homeBriefing).not.toContain("Rich Threads");
    expect(homeBriefing).not.toContain("Automatic Learning");
  });
});
