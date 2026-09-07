import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { DocumentPage } from "@/skins/keel/pages/document";
import {
  consumeSectionTarget,
  requestSection,
} from "@/skins/keel/knowledge/citation-target";

/**
 * A5 regression coverage: clicking a SECOND citation into the same open policy
 * document must still scroll + highlight. The reader can no longer infer the
 * target from the (non-reactive) hash — it reacts to an explicit
 * `requestSection` signal, exactly as tools.tsx emits on a citation click.
 */

// The reader reads its docId from the route; drive it deterministically.
const route: { rest: string[] | undefined } = {
  rest: ["knowledge", "phi-access-policy"],
};
vi.mock("next/navigation", () => ({
  useParams: () => ({ skin: "keel", rest: route.rest }),
}));
// The not-found branch renders next/link; a plain anchor keeps the mock trivial
// and avoids pulling the real router into jsdom.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The page now registers a beat-3b on-screen readable. `useAgentContext` reaches
// `useCopilotKit`, which THROWS outside a provider by design, and this tree is
// rendered bare — so it is stubbed rather than the throw tolerated. Nothing here
// asserts on the readable (that is `on-screen-readables.test.tsx`'s job).
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => {},
}));

// The page reads the register overlay off the ledger snapshot. Stubbed empty so
// these citation-landing cases exercise the corpus half only, and so no test in
// this file reaches for the network.
vi.mock("@/skins/keel/ledger-context", () => ({
  useKeelLedger: () => ({
    data: {
      documents: [],
      runs: [],
      playbooks: [],
      personas: [],
      variances: [],
      impactBriefs: [],
      asOf: "2026-08-12T00:00:00.000Z",
    },
    refresh: async () => true,
    ready: true,
  }),
}));

const HIGHLIGHT = "bg-brand-soft";

function sectionEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`section #${id} was not rendered`);
  return el;
}

beforeEach(() => {
  route.rest = ["knowledge", "phi-access-policy"];
  // jsdom has no layout engine; scrollIntoView is a no-op stub.
  Element.prototype.scrollIntoView = vi.fn();
  window.location.hash = "";
  // The signal store is a module singleton shared across tests. Clear any
  // leftover target so each mount starts from a clean, un-highlighted baseline.
  consumeSectionTarget();
});
afterEach(() => cleanup());

describe("DocumentPage — citation landing", () => {
  it("highlights a SECOND citation into the same document (the A5 bug)", () => {
    render(<DocumentPage />);

    // First citation → its section is highlighted.
    act(() => requestSection("phi-access-policy", "scope"));
    expect(sectionEl("scope").className).toContain(HIGHLIGHT);
    expect(sectionEl("minimum-necessary").className).not.toContain(HIGHLIGHT);

    // Second citation into the SAME doc — only the fragment differs. This is the
    // exact path that previously did nothing (stable doc ref + no hashchange).
    act(() => requestSection("phi-access-policy", "minimum-necessary"));
    expect(sectionEl("minimum-necessary").className).toContain(HIGHLIGHT);
    expect(sectionEl("scope").className).not.toContain(HIGHLIGHT);
  });

  it("does NOT replay a consumed target when the same doc is re-opened with no hash", () => {
    // (i) Cite into a section: it scrolls + highlights, and is consumed from the
    // single-use store — exactly the correct first landing.
    const first = render(<DocumentPage />);
    act(() => requestSection("phi-access-policy", "minimum-necessary"));
    expect(sectionEl("minimum-necessary").className).toContain(HIGHLIGHT);

    // (ii) Navigate away, then re-open the SAME doc from the Knowledge list via a
    // plain link — no fragment, no new request. The old target must NOT resurface
    // on this fresh mount: the reader must land at the top, un-highlighted.
    first.unmount();
    render(<DocumentPage />);
    expect(sectionEl("minimum-necessary").className).not.toContain(HIGHLIGHT);
  });

  it("re-fires when the SAME section is cited twice", () => {
    render(<DocumentPage />);
    const scrollSpy = Element.prototype.scrollIntoView as ReturnType<
      typeof vi.fn
    >;

    act(() => requestSection("phi-access-policy", "audit-logging"));
    act(() => requestSection("phi-access-policy", "audit-logging"));

    expect(sectionEl("audit-logging").className).toContain(HIGHLIGHT);
    // Each distinct request (monotonic seq) scrolls again, even for one section.
    expect(scrollSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a target for a different doc and an unknown section", () => {
    render(<DocumentPage />);

    act(() => requestSection("some-other-doc", "scope"));
    expect(sectionEl("scope").className).not.toContain(HIGHLIGHT);

    act(() => requestSection("phi-access-policy", "no-such-section"));
    expect(sectionEl("scope").className).not.toContain(HIGHLIGHT);
    expect(sectionEl("minimum-necessary").className).not.toContain(HIGHLIGHT);
  });

  it("renders the Document-not-found page for an unknown docId", () => {
    route.rest = ["knowledge", "does-not-exist"];
    const { getByText } = render(<DocumentPage />);
    expect(getByText("Document not found")).toBeTruthy();
  });
});
