import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlaybookCard } from "@/skins/keel/components/playbook-card";
import type { Playbook } from "@/skins/keel/data/types";

// next/link renders as a plain anchor so jsdom needs no router. The href is
// preserved, which is what we assert against.
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

afterEach(() => cleanup());

const playbook: Playbook = {
  id: "pb-access",
  title: "Grant PHI access",
  summary: "Provision access for a new contractor.",
  space: "privacy",
  inputs: [],
  steps: [
    {
      id: "s1",
      title: "Verify minimum-necessary scope",
      role: "Compliance Officer",
      requiresApproval: true,
      approverRole: "Compliance Officer",
      durationMs: 1000,
      policyRef: {
        docId: "phi-access-policy",
        sectionId: "minimum-necessary",
        ref: "HIPAA-164.514",
      },
    },
  ],
};

describe("PlaybookCard pointer-events (in-chat citation link is live)", () => {
  it("renders the per-step policy link inside a pointer-events-auto subtree", () => {
    render(<PlaybookCard playbook={playbook} />);

    // The policy reference the card renders per gated step, as a next/link.
    const link = screen.getByRole("link", {
      name: /HIPAA-164\.514/,
    });
    expect(link.getAttribute("href")).toBe(
      "/keel/knowledge/phi-access-policy#minimum-necessary",
    );

    // CopilotKit paints `useComponent` renders with `pointer-events: none`, so
    // this link is DEAD in chat unless an ancestor re-enables pointer events.
    // The card must root itself in a `pointer-events-auto` boundary (ChatSurface)
    // — assert the link lives inside one. This is the fix's covering assertion:
    // without it the link silently no-ops on the citation/grounding path.
    expect(link.closest(".pointer-events-auto")).not.toBeNull();

    // And nothing between the link and that boundary re-disables events.
    expect(link.closest(".pointer-events-none")).toBeNull();
  });
});
