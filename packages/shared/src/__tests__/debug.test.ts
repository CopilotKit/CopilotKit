import { describe, it, expect } from "vitest";
import { resolveDebugConfig } from "../debug";

describe("resolveDebugConfig", () => {
  it("returns all-off for undefined", () => {
    expect(resolveDebugConfig(undefined)).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: false,
    });
  });

  it("returns all-off for false", () => {
    expect(resolveDebugConfig(false)).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: false,
    });
  });

  it("returns all-on (including verbose) for true", () => {
    expect(resolveDebugConfig(true)).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: true,
    });
  });

  it("defaults events and lifecycle to true, verbose to false for empty object", () => {
    expect(resolveDebugConfig({})).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: false,
    });
  });

  it("respects explicit events: true", () => {
    expect(resolveDebugConfig({ events: true })).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: false,
    });
  });

  it("respects explicit events: false (lifecycle still defaults true)", () => {
    expect(resolveDebugConfig({ events: false })).toEqual({
      enabled: true,
      events: false,
      lifecycle: true,
      verbose: false,
    });
  });

  it("respects explicit lifecycle: false (events still defaults true)", () => {
    expect(resolveDebugConfig({ lifecycle: false })).toEqual({
      enabled: true,
      events: true,
      lifecycle: false,
      verbose: false,
    });
  });

  it("defaults events and lifecycle to true when only verbose is set", () => {
    expect(resolveDebugConfig({ verbose: true })).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: true,
    });
  });

  it("sets enabled to false when both events and lifecycle are false", () => {
    expect(resolveDebugConfig({ events: false, lifecycle: false })).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: false,
    });
  });

  it("sets enabled to false even when verbose is true if events and lifecycle are both false", () => {
    expect(
      resolveDebugConfig({ events: false, lifecycle: false, verbose: true }),
    ).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: true,
    });
  });

  it("handles mixed config: events true, lifecycle false, verbose true", () => {
    expect(
      resolveDebugConfig({ events: true, lifecycle: false, verbose: true }),
    ).toEqual({
      enabled: true,
      events: true,
      lifecycle: false,
      verbose: true,
    });
  });
});
