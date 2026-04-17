import { describe, it, expect } from "vitest";
import { ErrorVisibility } from "@copilotkit/shared";
import { getErrorSuppression } from "../copilot-messages";

/**
 * Regression tests for #2431: error visibility when showDevConsole=false.
 *
 * The bug: `routeError` returned early for ALL errors when `isDev` was false,
 * suppressing TOAST and BANNER errors that should always reach the user.
 *
 * The fix: only SILENT and DEV_ONLY errors are suppressed in production;
 * TOAST, BANNER, and untagged errors are always surfaced.
 */
describe("getErrorSuppression — error visibility routing (#2431)", () => {
  // --- Production (isDev = false) ---

  it("surfaces TOAST errors in production", () => {
    expect(getErrorSuppression(ErrorVisibility.TOAST, false)).toBeNull();
  });

  it("surfaces BANNER errors in production", () => {
    expect(getErrorSuppression(ErrorVisibility.BANNER, false)).toBeNull();
  });

  it("suppresses DEV_ONLY errors in production", () => {
    expect(getErrorSuppression(ErrorVisibility.DEV_ONLY, false)).not.toBeNull();
  });

  it("suppresses SILENT errors in production", () => {
    expect(getErrorSuppression(ErrorVisibility.SILENT, false)).not.toBeNull();
  });

  it("surfaces errors with no visibility tag in production", () => {
    expect(getErrorSuppression(undefined, false)).toBeNull();
  });

  // --- Development (isDev = true) ---

  it("surfaces TOAST errors in development", () => {
    expect(getErrorSuppression(ErrorVisibility.TOAST, true)).toBeNull();
  });

  it("surfaces BANNER errors in development", () => {
    expect(getErrorSuppression(ErrorVisibility.BANNER, true)).toBeNull();
  });

  it("surfaces DEV_ONLY errors in development", () => {
    expect(getErrorSuppression(ErrorVisibility.DEV_ONLY, true)).toBeNull();
  });

  it("suppresses SILENT errors in development", () => {
    expect(getErrorSuppression(ErrorVisibility.SILENT, true)).not.toBeNull();
  });

  it("surfaces errors with no visibility tag in development", () => {
    expect(getErrorSuppression(undefined, true)).toBeNull();
  });

  // --- Log prefix strings ---

  it("returns a 'Silent Error' prefix for SILENT visibility", () => {
    const prefix = getErrorSuppression(ErrorVisibility.SILENT, false);
    expect(prefix).toContain("Silent");
  });

  it("returns a 'hidden in production' prefix for DEV_ONLY visibility", () => {
    const prefix = getErrorSuppression(ErrorVisibility.DEV_ONLY, false);
    expect(prefix).toContain("hidden in production");
  });
});
