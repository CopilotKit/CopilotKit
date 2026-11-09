import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LockedSkinProvider } from "@/shell/locked-skin-context";
import { useSkinHref } from "@/shell/skin-path";
import { bookPath, browseTarget } from "./nav-target";

// The compositions consume the REAL `useSkinHref` builder, so render a probe and
// exercise it under both lock states rather than stubbing the builder.
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function BrowseProbe({ qs }: { qs: string }) {
  const skinHref = useSkinHref("bookstore");
  return <span data-testid="out">{browseTarget(skinHref, qs)}</span>;
}

function BookProbe({ slug }: { slug: string }) {
  const skinHref = useSkinHref("bookstore");
  return <span data-testid="out">{skinHref(bookPath(slug))}</span>;
}

// Query the render's OWN container (not the shared document body) so a test may
// render several probes without their `data-testid="out"` nodes colliding.
function renderLocked(node: React.ReactNode, locked: string | null): string {
  const { container } = render(
    <LockedSkinProvider lockedSkinId={locked}>{node}</LockedSkinProvider>,
  );
  return container.querySelector('[data-testid="out"]')?.textContent ?? "";
}

describe("browseTarget — unlocked", () => {
  it("builds the browse path and preserves the query string", () => {
    expect(renderLocked(<BrowseProbe qs="" />, null)).toBe("/bookstore");
    expect(renderLocked(<BrowseProbe qs="genre=scifi" />, null)).toBe(
      "/bookstore?genre=scifi",
    );
  });
});

describe("browseTarget — locked (LOCK_SKIN)", () => {
  // The defect this fixes: `${base}?${qs}` produced `/?genre=scifi` only
  // because the base is already "/" under a lock — but `${base}${qs}` (no
  // arg) would collapse to "" without the `|| "/"` fallback in skinHref.
  it("builds / without a leading //, query string intact", () => {
    const bare = renderLocked(<BrowseProbe qs="" />, "bookstore");
    expect(bare).toBe("/");
    expect(bare).not.toContain("//");

    const withQs = renderLocked(<BrowseProbe qs="genre=scifi" />, "bookstore");
    expect(withQs).toBe("/?genre=scifi");
    expect(withQs).not.toContain("//");
  });
});

describe("bookPath — unlocked", () => {
  it("builds the book detail path below the skin base", () => {
    expect(renderLocked(<BookProbe slug="kairos" />, null)).toBe(
      "/bookstore/book/kairos",
    );
  });
});

describe("bookPath — locked (LOCK_SKIN)", () => {
  // The defect this fixes: `${base}/book/${slug}` produced `//book/kairos`
  // (a protocol-relative URL that navigates off-site) because the locked
  // no-arg base is "/", not "".
  it("maps the book detail path WITHOUT a leading // (the bug)", () => {
    const out = renderLocked(<BookProbe slug="kairos" />, "bookstore");
    expect(out).toBe("/book/kairos");
    expect(out).not.toContain("//");
  });
});
