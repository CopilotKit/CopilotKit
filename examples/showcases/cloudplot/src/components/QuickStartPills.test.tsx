import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLOUDPLOT_QUICK_START_PROMPTS } from "@/lib/cloudplot-fixture";

const source = readFileSync(join(__dirname, "QuickStartPills.tsx"), "utf8");

describe("QuickStartPills", () => {
  it("pins all four recovered prompt strings in source order", () => {
    for (const prompt of CLOUDPLOT_QUICK_START_PROMPTS) {
      expect(source).toContain(prompt);
    }
  });
});
