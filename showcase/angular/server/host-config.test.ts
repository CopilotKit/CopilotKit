import { describe, expect, it } from "vitest";

import { readHostConfig } from "./host-config.js";

describe("Angular Showcase host configuration", () => {
  it("reports missing backend routing without exposing a value", () => {
    expect(readHostConfig({ NODE_ENV: "production" })).toMatchObject({
      port: 3000,
      production: true,
      backendHostPattern: undefined,
      backendConfigStatus: "missing",
      frameAncestors: ["'self'", "https://showcase.staging.copilotkit.ai"],
    });
  });

  it("accepts a valid staging backend pattern and exact frame ancestors", () => {
    expect(
      readHostConfig({
        NODE_ENV: "production",
        PORT: "4300",
        SHOWCASE_BACKEND_HOST_PATTERN: "showcase-{slug}-staging.up.railway.app",
        SHOWCASE_FRAME_ANCESTORS:
          "https://showcase.staging.copilotkit.ai https://preview.example.test",
      }),
    ).toMatchObject({
      port: 4300,
      backendConfigStatus: "valid",
      frameAncestors: [
        "'self'",
        "https://showcase.staging.copilotkit.ai",
        "https://preview.example.test",
      ],
    });
  });

  it("marks unsafe backend patterns invalid and drops invalid ancestors", () => {
    expect(
      readHostConfig({
        NODE_ENV: "production",
        SHOWCASE_BACKEND_HOST_PATTERN: "http://localhost:3001/{slug}",
        SHOWCASE_FRAME_ANCESTORS:
          "* javascript:alert(1) https://user:secret@example.test https://good.example.test/path",
      }),
    ).toMatchObject({
      backendHostPattern: undefined,
      backendConfigStatus: "invalid",
      frameAncestors: ["'self'"],
    });
  });

  it("rejects invalid ports instead of coercing them", () => {
    expect(() => readHostConfig({ PORT: "0" })).toThrow(/PORT/);
    expect(() => readHostConfig({ PORT: "3000junk" })).toThrow(/PORT/);
  });
});
