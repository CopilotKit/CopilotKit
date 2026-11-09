/**
 * Keel is the ONLY skin in this app with parameterized routes, and that property
 * has to survive every change to its pages.
 *
 * `../skin.test.tsx` already pins the RESOLUTION half — that
 * `resolvePage(["knowledge", x])` and `resolvePage(["runs", y])` return the two
 * detail components. This file pins the half a resolver test cannot see: that
 * those two components, mounted on a real id, actually RENDER that record. A
 * page can resolve perfectly and then throw on mount, or paint its own
 * "not found" body for an id the store does carry — both leave the resolver
 * test green and the route broken.
 *
 * Both halves are asserted here so the file fails on its own terms if either
 * regresses, rather than depending on a sibling test nobody edited.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Run } from "../data/types";

const route: { rest: string[] | undefined } = { rest: undefined };

vi.mock("next/navigation", () => ({
  useParams: () => ({ skin: "keel", rest: route.rest }),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));

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

/**
 * Both pages register a beat-3b readable, and `useAgentContext` throws outside a
 * CopilotKit provider by design. Only THAT hook is replaced — the rest of the
 * module is spread through from the real one, because this file imports
 * `../skin`, which pulls in `tools.tsx` and its dozen other imports from the
 * same package. A wholesale stub would break those at module-eval time, and the
 * failure would look nothing like its cause.
 */
vi.mock("@copilotkit/react-core/v2", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAgentContext: () => {},
}));

/**
 * BOTH parameterized routes now read the SAME ledger snapshot.
 *
 * `runs/<runId>` used to render from `useKeelData` through `useSkinData`; that
 * hook is gone, runs live in the REST ledger beside the policy register, and the
 * page reads them through `useKeelDesk()` — which is `useKeelLedger()` plus the
 * pure derivations. So the run below is seeded into the ledger mock, and this
 * test is now also the proof that the migration did not cost keel the one
 * property no other skin has.
 */
const run: Run = {
  id: "RUN-9001",
  playbookId: "phi-access-request",
  title: "PHI access request",
  subject: "Priya Raman — Radiology contractor",
  requestedBy: "Ana Reyes",
  createdAt: "2026-08-11T09:00:00.000Z",
  status: "running",
  steps: [
    {
      id: "verify",
      title: "Verify sponsorship",
      role: "HR Operations",
      durationMs: 4000,
      requiresApproval: false,
      status: "running",
      startedAt: "2026-08-11T09:00:00.000Z",
    },
  ],
};

vi.mock("../ledger-context", () => ({
  KeelLedgerProvider: ({ children }: { children: React.ReactNode }) => children,
  useKeelLedger: () => ({
    data: {
      documents: [],
      runs: [run],
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

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "keel" }),
}));

import keel from "../skin";
import { DocumentPage } from "./document";
import { RunDetailPage } from "./run-detail";

afterEach(() => {
  cleanup();
  route.rest = undefined;
});

describe("keel parameterized routes survive", () => {
  it("resolves knowledge/<docId> and runs/<runId> to their detail pages", () => {
    expect(keel.resolvePage(["knowledge", "phi-access-policy"])).toBe(
      DocumentPage,
    );
    expect(keel.resolvePage(["runs", "RUN-9001"])).toBe(RunDetailPage);
    // Still a 404 for anything deeper or unknown — the parameterized routes are
    // exactly two segments, not a catch-all.
    expect(keel.resolvePage(["knowledge", "a", "b"])).toBeNull();
    expect(keel.resolvePage(["unknown", "x"])).toBeNull();
  });

  it("renders the document a knowledge/<docId> URL names", () => {
    route.rest = ["knowledge", "phi-access-policy"];
    render(<DocumentPage />);
    // The real corpus document, not the not-found body.
    expect(document.body.textContent).toContain("POL-114");
    expect(document.body.textContent).not.toContain("Document not found");
    expect(
      document.querySelectorAll("article > section[id]").length,
    ).toBeGreaterThan(1);
  });

  it("renders the run a runs/<runId> URL names", () => {
    route.rest = ["runs", "RUN-9001"];
    render(<RunDetailPage />);
    expect(document.body.textContent).toContain("RUN-9001");
    expect(document.body.textContent).toContain(
      "Priya Raman — Radiology contractor",
    );
    expect(document.body.textContent).not.toContain("Run not found");
  });

  it("renders an in-page not-found body — never a 404 — for an unknown id", () => {
    // An unknown id is a structurally VALID route with a "not found" body.
    // Returning null from `resolvePage` would 404 it, which is the wrong signal
    // and would break a citation deep-link into a document that was renamed.
    route.rest = ["knowledge", "no-such-doc"];
    const { unmount } = render(<DocumentPage />);
    expect(document.body.textContent).toContain("Document not found");
    unmount();

    route.rest = ["runs", "RUN-0000"];
    render(<RunDetailPage />);
    expect(document.body.textContent).toContain("Run not found");
  });
});
