import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LockedSkinProvider } from "@/shell/locked-skin-context";
import { useVantageHref, useVantageSegments } from "./href";

/**
 * The two halves of vantage's LOCK_SKIN URL contract, pinned under BOTH lock
 * states. The unlocked expectations are the regression guard for the migration
 * itself: the multi-skin demo must keep emitting exactly the `/vantage/...`
 * URLs it emitted before every link was routed through the builder.
 *
 * Mirrors banking's `nav-target.test.tsx` — consume the REAL builder through a
 * probe rather than stubbing it, since the thing under test IS the composition.
 */

// `useSkinSegments` reads `usePathname`; the builder does not. A mutable holder
// lets each case set the address-bar path it is simulating.
let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

function HrefProbe({ path }: { path?: string }) {
  const vantageHref = useVantageHref();
  return <span data-testid="out">{vantageHref(path)}</span>;
}

function SegmentsProbe() {
  const segments = useVantageSegments();
  return <span data-testid="out">{JSON.stringify(segments)}</span>;
}

// Query the render's OWN container so several probes can coexist in one file
// without their `data-testid="out"` nodes colliding.
function renderLocked(node: React.ReactNode, locked: string | null): string {
  const { container } = render(
    <LockedSkinProvider lockedSkinId={locked}>{node}</LockedSkinProvider>,
  );
  return container.querySelector('[data-testid="out"]')?.textContent ?? "";
}

describe("useVantageHref — unlocked (today's URLs)", () => {
  it("keeps the prefix on the index, a page and a board", () => {
    expect(renderLocked(<HrefProbe />, null)).toBe("/vantage");
    expect(renderLocked(<HrefProbe path="" />, null)).toBe("/vantage");
    expect(renderLocked(<HrefProbe path="explore" />, null)).toBe(
      "/vantage/explore",
    );
    expect(renderLocked(<HrefProbe path="boards/q2-review" />, null)).toBe(
      "/vantage/boards/q2-review",
    );
  });
});

describe("useVantageHref — locked (LOCK_SKIN=vantage)", () => {
  it("drops the prefix without ever emitting a protocol-relative //", () => {
    expect(renderLocked(<HrefProbe />, "vantage")).toBe("/");
    expect(renderLocked(<HrefProbe path="" />, "vantage")).toBe("/");
    const page = renderLocked(<HrefProbe path="explore" />, "vantage");
    expect(page).toBe("/explore");
    expect(page).not.toContain("//");
    expect(renderLocked(<HrefProbe path="boards/q2-review" />, "vantage")).toBe(
      "/boards/q2-review",
    );
  });

  it("keeps ANOTHER skin's links prefixed — the lock is not a retarget", () => {
    // The builder is handed vantage's id, so a `LOCK_SKIN=banking` deploy must
    // leave vantage's own links alone.
    expect(renderLocked(<HrefProbe path="explore" />, "banking")).toBe(
      "/vantage/explore",
    );
  });
});

describe("useVantageSegments", () => {
  it("strips the prefix when the address bar carries it", () => {
    pathname = "/vantage/boards/q2-review";
    expect(renderLocked(<SegmentsProbe />, null)).toBe(
      '["boards","q2-review"]',
    );
    pathname = "/vantage";
    expect(renderLocked(<SegmentsProbe />, null)).toBe("[]");
  });

  it("returns the same segments when the prefix is absent (a lock)", () => {
    // THE bug the old `pathname.split("/").slice(2)` produced: on a locked
    // deploy it ate `explore` and reported the Boardroom, so no nav entry was
    // ever marked active.
    pathname = "/boards/q2-review";
    expect(renderLocked(<SegmentsProbe />, "vantage")).toBe(
      '["boards","q2-review"]',
    );
    pathname = "/explore";
    expect(renderLocked(<SegmentsProbe />, "vantage")).toBe('["explore"]');
    pathname = "/";
    expect(renderLocked(<SegmentsProbe />, "vantage")).toBe("[]");
  });
});
