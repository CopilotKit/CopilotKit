// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ReactGA from "react-ga4";
import { useGoogleAnalytics } from "./use-google-analytics";

const config = vi.hoisted(() => ({ googleAnalyticsTrackingId: "" }));
vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => config,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/quickstart" }));
vi.mock("react-ga4", () => ({
  default: { initialize: vi.fn(), send: vi.fn() },
}));

afterEach(() => {
  cleanup();
  config.googleAnalyticsTrackingId = "";
  vi.clearAllMocks();
});

it("can enable and disable analytics between renders without changing hook order", () => {
  const { rerender } = renderHook(useGoogleAnalytics);
  expect(ReactGA.initialize).not.toHaveBeenCalled();
  expect(ReactGA.send).not.toHaveBeenCalled();

  config.googleAnalyticsTrackingId = "G-TEST";
  expect(() => rerender()).not.toThrow();
  expect(ReactGA.initialize).toHaveBeenCalledWith([{ trackingId: "G-TEST" }]);
  expect(ReactGA.send).toHaveBeenCalledOnce();

  config.googleAnalyticsTrackingId = "";
  expect(() => rerender()).not.toThrow();
  expect(ReactGA.send).toHaveBeenCalledOnce();
});
