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

  it("returns events + lifecycle on but verbose off for true (PII safety)", () => {
    expect(resolveDebugConfig(true)).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: false,
    });
  });

  it("allows explicit verbose opt-in via object shorthand", () => {
    expect(resolveDebugConfig({ verbose: true })).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: true,
    });
  });

  it("allows explicit verbose opt-in with events", () => {
    expect(resolveDebugConfig({ events: true, verbose: true })).toEqual({
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

  it("sets enabled to false when both events and lifecycle are false", () => {
    expect(resolveDebugConfig({ events: false, lifecycle: false })).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: false,
    });
  });

  it("clamps verbose to false when enabled is false (events and lifecycle both false)", () => {
    expect(
      resolveDebugConfig({ events: false, lifecycle: false, verbose: true }),
    ).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: false,
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
