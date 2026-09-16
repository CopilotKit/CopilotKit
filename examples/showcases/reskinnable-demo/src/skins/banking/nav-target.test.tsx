import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LockedSkinProvider } from "@/shell/locked-skin-context";
import { useSkinHref } from "@/shell/skin-path";
import { navTarget, chargesTarget } from "./nav-target";

// The compositions consume the REAL `useSkinHref` builder, so render a probe and
// exercise it under both lock states rather than stubbing the builder. The hook
// reads the pathname via useSkinSegments' sibling only indirectly; navTarget
// itself does not, so a fixed pathname is fine here.
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function NavProbe({ page }: { page: string }) {
  const skinHref = useSkinHref("banking");
  return <span data-testid="out">{navTarget(skinHref, page)}</span>;
}

function ChargesProbe({ qs }: { qs: string }) {
  const skinHref = useSkinHref("banking");
  return <span data-testid="out">{chargesTarget(skinHref, qs)}</span>;
}

// Query the render's OWN container (not the shared document body) so a test may
// render several probes without their `data-testid="out"` nodes colliding.
function renderLocked(node: React.ReactNode, locked: string | null): string {
  const { container } = render(
    <LockedSkinProvider lockedSkinId={locked}>{node}</LockedSkinProvider>,
  );
  return container.querySelector('[data-testid="out"]')?.textContent ?? "";
}

describe("navTarget — unlocked", () => {
  it('sends "/" and the "/cards" alias to the skin index', () => {
    expect(renderLocked(<NavProbe page="/" />, null)).toBe("/banking");
    expect(renderLocked(<NavProbe page="/cards" />, null)).toBe("/banking");
  });

  it("maps another page to its segment below the skin base", () => {
    expect(renderLocked(<NavProbe page="/team" />, null)).toBe("/banking/team");
  });
});

describe("navTarget — locked (LOCK_SKIN)", () => {
  it("drops the prefix for the index without emitting //", () => {
    expect(renderLocked(<NavProbe page="/" />, "banking")).toBe("/");
    expect(renderLocked(<NavProbe page="/cards" />, "banking")).toBe("/");
  });

  // The defect this fixes: `${base}${page.toLowerCase()}` produced `//team`
  // (a protocol-relative URL that navigates off-site) because the locked no-arg
  // base is "/", not "".
  it("maps another page WITHOUT a leading // (the bug)", () => {
    const out = renderLocked(<NavProbe page="/team" />, "banking");
    expect(out).toBe("/team");
    expect(out).not.toContain("//");
  });
});

describe("chargesTarget — unlocked", () => {
  it("builds the charges path and preserves the query string", () => {
    expect(renderLocked(<ChargesProbe qs="" />, null)).toBe("/banking/charges");
    expect(
      renderLocked(<ChargesProbe qs="sort=amount_desc&top=10" />, null),
    ).toBe("/banking/charges?sort=amount_desc&top=10");
  });
});

describe("chargesTarget — locked (LOCK_SKIN)", () => {
  // The defect this fixes: `${base}/charges` produced `//charges` under a lock.
  it("builds /charges WITHOUT a leading //, query string intact", () => {
    const bare = renderLocked(<ChargesProbe qs="" />, "banking");
    expect(bare).toBe("/charges");
    expect(bare).not.toContain("//");

    const withQs = renderLocked(
      <ChargesProbe qs="sort=amount_desc&top=10" />,
      "banking",
    );
    expect(withQs).toBe("/charges?sort=amount_desc&top=10");
    expect(withQs).not.toContain("//");
  });
});
