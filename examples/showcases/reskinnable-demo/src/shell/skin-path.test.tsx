import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LockedSkinProvider } from "./locked-skin-context";
import { useSkinHref, useSkinSegments } from "./skin-path";

// `useSkinSegments` reads the pathname; each case sets it before rendering.
let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

function HrefProbe({ skinId, path }: { skinId: string; path?: string }) {
  return <span data-testid="href">{useSkinHref(skinId)(path)}</span>;
}

function SegmentsProbe({ skinId }: { skinId: string }) {
  return (
    <span data-testid="segments">{useSkinSegments(skinId).join(",")}</span>
  );
}

function renderLocked(node: React.ReactNode, locked: string | null) {
  render(<LockedSkinProvider lockedSkinId={locked}>{node}</LockedSkinProvider>);
}

describe("useSkinHref — unlocked", () => {
  it("prefixes the skin segment", () => {
    renderLocked(<HrefProbe skinId="banking" path="cards" />, null);
    expect(screen.getByTestId("href").textContent).toBe("/banking/cards");
  });

  it("returns the skin root for the index", () => {
    renderLocked(<HrefProbe skinId="banking" />, null);
    expect(screen.getByTestId("href").textContent).toBe("/banking");
  });

  it("handles a multi-segment path", () => {
    renderLocked(<HrefProbe skinId="keel" path="runs/r-1" />, null);
    expect(screen.getByTestId("href").textContent).toBe("/keel/runs/r-1");
  });

  it("defaults to unlocked with no provider, so bare unit renders are unchanged", () => {
    render(<HrefProbe skinId="keel" path="knowledge/privacy" />);
    expect(screen.getByTestId("href").textContent).toBe(
      "/keel/knowledge/privacy",
    );
  });
});

describe("useSkinHref — locked", () => {
  it("drops the prefix entirely", () => {
    renderLocked(<HrefProbe skinId="banking" path="cards" />, "banking");
    expect(screen.getByTestId("href").textContent).toBe("/cards");
  });

  // "" is not a usable href — React would render `<a href="">`, which re-requests
  // the CURRENT url rather than navigating to the root.
  it('returns "/" for the index, never the empty string', () => {
    renderLocked(<HrefProbe skinId="banking" />, "banking");
    expect(screen.getByTestId("href").textContent).toBe("/");
  });

  it("keeps deep paths intact", () => {
    renderLocked(<HrefProbe skinId="keel" path="runs/r-1" />, "keel");
    expect(screen.getByTestId("href").textContent).toBe("/runs/r-1");
  });

  it("tolerates a caller's leading slash rather than emitting //", () => {
    renderLocked(<HrefProbe skinId="keel" path="/runs/r-1" />, "keel");
    expect(screen.getByTestId("href").textContent).toBe("/runs/r-1");
  });

  // The prefix is dropped ONLY for the skin that is actually locked. A caller
  // asking for a DIFFERENT skin's href still gets the prefixed form, so the
  // builder can never silently retarget an `airline` link at the `banking`
  // deploy. (Not reachable in the running app — the locked deploy 404s every
  // non-locked skin before it mounts — but the hook must be correct on its
  // own, not only under that external invariant.)
  it("keeps the prefix for a skin that is NOT the locked one", () => {
    renderLocked(<HrefProbe skinId="airline" path="trips" />, "banking");
    expect(screen.getByTestId("href").textContent).toBe("/airline/trips");
  });
});

describe("useSkinSegments", () => {
  // The point of the strip-if-present design: BOTH spellings of the pathname
  // yield the same segments, so the nav's active state cannot depend on whether
  // `usePathname()` reports the browser URL or the rewritten route.
  it("strips the skin id when the pathname carries it", () => {
    pathname = "/banking/dashboard";
    renderLocked(<SegmentsProbe skinId="banking" />, null);
    expect(screen.getByTestId("segments").textContent).toBe("dashboard");
  });

  it("returns the path as-is when the prefix is already absent", () => {
    pathname = "/dashboard";
    renderLocked(<SegmentsProbe skinId="banking" />, "banking");
    expect(screen.getByTestId("segments").textContent).toBe("dashboard");
  });

  it("is empty on the skin index, prefixed or not", () => {
    pathname = "/banking";
    renderLocked(<SegmentsProbe skinId="banking" />, null);
    expect(screen.getByTestId("segments").textContent).toBe("");
  });

  it("is empty at the root of a locked deploy", () => {
    pathname = "/";
    renderLocked(<SegmentsProbe skinId="banking" />, "banking");
    expect(screen.getByTestId("segments").textContent).toBe("");
  });

  it("keeps parameterized segments below the skin", () => {
    pathname = "/keel/knowledge/phi-access-policy";
    renderLocked(<SegmentsProbe skinId="keel" />, null);
    expect(screen.getByTestId("segments").textContent).toBe(
      "knowledge,phi-access-policy",
    );
  });

  // The old `slice(2)` ate the first real segment whenever the prefix was
  // absent, reporting "" (the index) for what is actually /dashboard — which
  // would have highlighted the wrong nav entry on every locked page.
  it("does not eat the first segment when unprefixed", () => {
    pathname = "/runs/r-1";
    renderLocked(<SegmentsProbe skinId="keel" />, "keel");
    expect(screen.getByTestId("segments").textContent).toBe("runs,r-1");
  });
});
