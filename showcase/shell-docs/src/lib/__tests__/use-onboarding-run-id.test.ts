// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useOnboardingRunId } from "@/lib/hooks/use-onboarding-run-id";

it("returns one id for the lifetime of a mount", () => {
  const { result } = renderHook(() => useOnboardingRunId());

  // Two separate reads of the getter on the same mount — standing in for two
  // clicks of a button that both call it — must agree: this is the guarantee
  // that keeps repeated clicks from minting a fresh id (and a fresh,
  // unclosable funnel row) every time.
  const first = result.current();
  const second = result.current();
  expect(first).toBe(second);
  expect(first).toMatch(/^[0-9a-f]{12}$/);
});

it("mints a different id for each separate mount", () => {
  const first = renderHook(() => useOnboardingRunId());
  const firstId = first.result.current();
  first.unmount();

  const second = renderHook(() => useOnboardingRunId());
  const secondId = second.result.current();
  second.unmount();

  expect(secondId).not.toBe(firstId);
});
