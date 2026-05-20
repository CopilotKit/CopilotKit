import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiscoveryAuthBanner } from "../discovery-auth-banner";
import type { StatusRow } from "@/lib/live-status";

function row(
  key: string,
  state: StatusRow["state"],
  signal: unknown = {},
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension: key.split(":")[0] ?? "system",
    state,
    signal,
    observed_at: "2026-05-14T00:00:00Z",
    transitioned_at: "2026-05-14T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

describe("DiscoveryAuthBanner", () => {
  it("renders when system row is red (discovery-auth-failed)", () => {
    const rows: StatusRow[] = [row("system:discovery-auth-failed", "red")];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(screen.queryByTestId("discovery-auth-banner")).toBeInTheDocument();
  });

  it("shows cached variant when signal.cacheStatus is serving-stale", () => {
    const rows: StatusRow[] = [
      row("system:discovery-auth-failed", "red", {
        cacheStatus: "serving-stale",
      }),
    ];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(
      screen.getByText(
        "Authentication failed for discovery source — serving stale cached data. Refresh tokens to restore live updates.",
      ),
    ).toBeInTheDocument();
  });

  it("shows offline variant when signal.cacheStatus is no-cache", () => {
    const rows: StatusRow[] = [
      row("system:discovery-auth-failed", "red", {
        cacheStatus: "no-cache",
      }),
    ];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(
      screen.getByText(
        "Authentication failed for discovery source — no cached data available. Discovery results may be incomplete.",
      ),
    ).toBeInTheDocument();
  });

  it("returns null when no system row is present", () => {
    const rows: StatusRow[] = [row("health:some-integration", "green")];
    const { container } = render(<DiscoveryAuthBanner rows={rows} />);
    expect(container.innerHTML).toBe("");
    expect(
      screen.queryByTestId("discovery-auth-banner"),
    ).not.toBeInTheDocument();
  });

  it("returns null when system row state is green", () => {
    const rows: StatusRow[] = [row("system:discovery-auth-failed", "green")];
    const { container } = render(<DiscoveryAuthBanner rows={rows} />);
    expect(container.innerHTML).toBe("");
    expect(
      screen.queryByTestId("discovery-auth-banner"),
    ).not.toBeInTheDocument();
  });

  it("renders sourceName from signal instead of fallback", () => {
    const rows: StatusRow[] = [
      row("system:discovery-auth-failed", "red", {
        cacheStatus: "no-cache",
        sourceName: "railway-services",
      }),
    ];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(
      screen.getByText(
        "Authentication failed for railway-services — no cached data available. Discovery results may be incomplete.",
      ),
    ).toBeInTheDocument();
  });

  it("banner handles non-object signal gracefully", () => {
    const rows: StatusRow[] = [
      row("system:discovery-auth-failed", "red", "unexpected string"),
    ];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(screen.queryByTestId("discovery-auth-banner")).toBeInTheDocument();
    // With a non-object signal, the banner should fall back to default
    // message (no-cache variant with generic source name).
    expect(
      screen.getByText(
        "Authentication failed for discovery source — no cached data available. Discovery results may be incomplete.",
      ),
    ).toBeInTheDocument();
  });

  it("has role=alert for accessibility", () => {
    const rows: StatusRow[] = [row("system:discovery-auth-failed", "red")];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders browser-pool-banner when system:browser-pool-degraded row is red", () => {
    const rows: StatusRow[] = [row("system:browser-pool-degraded", "red")];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(screen.queryByTestId("browser-pool-banner")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Browser pool initialization failed — e2e probes running in degraded mode with stub drivers.",
      ),
    ).toBeInTheDocument();
  });

  it("shows error message from signal when available", () => {
    const rows: StatusRow[] = [
      row("system:browser-pool-degraded", "red", {
        errorMessage: "playwright not installed",
        degradedSince: "2026-05-14T00:00:00Z",
      }),
    ];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(
      screen.getByText(
        "Browser pool initialization failed — e2e probes running in degraded mode with stub drivers. (playwright not installed)",
      ),
    ).toBeInTheDocument();
  });

  it("does not render browser-pool-banner when row state is green", () => {
    const rows: StatusRow[] = [row("system:browser-pool-degraded", "green")];
    const { container } = render(<DiscoveryAuthBanner rows={rows} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("browser-pool-banner")).not.toBeInTheDocument();
  });

  it("renders both banners simultaneously when both conditions are red", () => {
    const rows: StatusRow[] = [
      row("system:discovery-auth-failed", "red", {
        cacheStatus: "no-cache",
        sourceName: "railway-services",
      }),
      row("system:browser-pool-degraded", "red", {
        errorMessage: "boom",
      }),
    ];
    render(<DiscoveryAuthBanner rows={rows} />);
    expect(screen.queryByTestId("discovery-auth-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-pool-banner")).toBeInTheDocument();
  });
});
