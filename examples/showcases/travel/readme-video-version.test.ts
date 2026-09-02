import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readme = readFileSync(
  fileURLToPath(new URL("./README.md", import.meta.url)),
  "utf8",
);

describe("README tutorial video", () => {
  it("labels the legacy video and links to current v2 guidance", () => {
    const videoSection = readme.match(
      /## Tutorial Video([\s\S]*?)## Overview/,
    )?.[1];

    expect(videoSection).toBeDefined();
    expect(videoSection).toContain("original CopilotKit v1 implementation");
    expect(videoSection).toContain(
      "https://docs.copilotkit.ai/langgraph/tutorials/ai-travel-app",
    );
    expect(videoSection).toContain("https://docs.copilotkit.ai/migrate/v2");
    expect(videoSection).toContain(
      "https://www.youtube.com/watch?v=9v3kXiOY3vg",
    );
  });
});
