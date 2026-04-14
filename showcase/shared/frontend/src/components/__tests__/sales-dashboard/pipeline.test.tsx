import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pipeline } from "../../sales-dashboard/pipeline";
import type { SalesTodo } from "../../../types";

const deals: SalesTodo[] = [
  {
    id: "1",
    title: "Acme Corp",
    stage: "prospect",
    value: 50000,
    dueDate: "2026-04-20",
    assignee: "Alice",
    completed: false,
  },
  {
    id: "2",
    title: "TechStart",
    stage: "prospect",
    value: 30000,
    dueDate: "2026-04-21",
    assignee: "Bob",
    completed: false,
  },
  {
    id: "3",
    title: "BigCo",
    stage: "closed-won",
    value: 120000,
    dueDate: "2026-04-15",
    assignee: "Alice",
    completed: true,
  },
];

describe("Pipeline", () => {
  it("renders all six stage columns", () => {
    render(<Pipeline deals={deals} />);
    expect(screen.getByText("Prospect")).toBeTruthy();
    expect(screen.getByText("Qualified")).toBeTruthy();
    expect(screen.getByText("Proposal")).toBeTruthy();
    expect(screen.getByText("Negotiation")).toBeTruthy();
    expect(screen.getByText("Closed Won")).toBeTruthy();
    expect(screen.getByText("Closed Lost")).toBeTruthy();
  });

  it("renders pipeline board container", () => {
    render(<Pipeline deals={deals} />);
    expect(screen.getByTestId("pipeline-board")).toBeTruthy();
  });

  it("places deals in the correct stage columns", () => {
    render(<Pipeline deals={deals} />);
    // Prospect column should have Acme Corp and TechStart
    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("TechStart")).toBeTruthy();
    // Closed Won column should have BigCo
    expect(screen.getByText("BigCo")).toBeTruthy();
  });

  it("shows deal count per column", () => {
    render(<Pipeline deals={deals} />);
    // Prospect has 2 deals, closed-won has 1
    const countBadges = screen.getAllByText("2");
    expect(countBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows total value in column header", () => {
    render(<Pipeline deals={deals} />);
    // Prospect total: 50000 + 30000 = 80000
    expect(screen.getByText("$80,000")).toBeTruthy();
    // Closed Won: 120000 — appears in both column header and deal card
    const matches = screen.getAllByText("$120,000");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty placeholder for stages with no deals", () => {
    render(<Pipeline deals={deals} />);
    // Qualified, Proposal, Negotiation, Closed Lost should show "No deals"
    const emptyMessages = screen.getAllByText("No deals");
    expect(emptyMessages.length).toBe(4);
  });

  it("renders with empty deals array", () => {
    render(<Pipeline deals={[]} />);
    const emptyMessages = screen.getAllByText("No deals");
    expect(emptyMessages.length).toBe(6);
  });

  it("renders deal cards inside the board", () => {
    render(<Pipeline deals={deals} />);
    const dealCards = screen.getAllByTestId("deal-card");
    expect(dealCards.length).toBe(3);
  });

  // --- Multiple deals per stage ---

  it("renders multiple deals within the same stage column", () => {
    render(<Pipeline deals={deals} />);
    // Both Acme Corp and TechStart are in prospect
    const prospectColumn = screen.getByRole("region", {
      name: /Prospect column/,
    });
    expect(prospectColumn).toBeTruthy();
    expect(prospectColumn.textContent).toContain("Acme Corp");
    expect(prospectColumn.textContent).toContain("TechStart");
  });

  it("shows correct count badge for columns with multiple deals", () => {
    render(<Pipeline deals={deals} />);
    // Prospect column should show "2" count badge
    const prospectColumn = screen.getByRole("region", {
      name: /Prospect column/,
    });
    expect(prospectColumn.textContent).toContain("2");
  });

  // --- Deals sorted into correct columns (exhaustive) ---

  it("distributes deals across all possible stages", () => {
    const allStageDeals: SalesTodo[] = [
      {
        id: "a",
        title: "Deal A",
        stage: "prospect",
        value: 10000,
        dueDate: "",
        assignee: "",
        completed: false,
      },
      {
        id: "b",
        title: "Deal B",
        stage: "qualified",
        value: 20000,
        dueDate: "",
        assignee: "",
        completed: false,
      },
      {
        id: "c",
        title: "Deal C",
        stage: "proposal",
        value: 30000,
        dueDate: "",
        assignee: "",
        completed: false,
      },
      {
        id: "d",
        title: "Deal D",
        stage: "negotiation",
        value: 40000,
        dueDate: "",
        assignee: "",
        completed: false,
      },
      {
        id: "e",
        title: "Deal E",
        stage: "closed-won",
        value: 50000,
        dueDate: "",
        assignee: "",
        completed: true,
      },
      {
        id: "f",
        title: "Deal F",
        stage: "closed-lost",
        value: 60000,
        dueDate: "",
        assignee: "",
        completed: false,
      },
    ];
    render(<Pipeline deals={allStageDeals} />);

    // Each column should have exactly 1 deal, so no "No deals" messages
    expect(screen.queryByText("No deals")).toBeNull();

    // All deal cards rendered
    const dealCards = screen.getAllByTestId("deal-card");
    expect(dealCards.length).toBe(6);
  });

  it("shows $0 total for empty columns", () => {
    render(<Pipeline deals={[]} />);
    // All columns should show $0
    const zeroValues = screen.getAllByText("$0");
    expect(zeroValues.length).toBe(6);
  });

  // --- Column structure ---

  it("each column has aria-label with stage name", () => {
    render(<Pipeline deals={deals} />);
    expect(
      screen.getByRole("region", { name: /Prospect column/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: /Qualified column/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: /Proposal column/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: /Negotiation column/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: /Closed Won column/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: /Closed Lost column/ }),
    ).toBeTruthy();
  });

  // --- Large dataset ---

  it("handles many deals across stages", () => {
    const manyDeals: SalesTodo[] = Array.from({ length: 20 }, (_, i) => ({
      id: `deal-${i}`,
      title: `Deal ${i}`,
      stage: (
        [
          "prospect",
          "qualified",
          "proposal",
          "negotiation",
          "closed-won",
          "closed-lost",
        ] as const
      )[i % 6],
      value: (i + 1) * 10000,
      dueDate: "2026-05-01",
      assignee: "Team",
      completed: false,
    }));
    render(<Pipeline deals={manyDeals} />);
    const dealCards = screen.getAllByTestId("deal-card");
    expect(dealCards.length).toBe(20);
  });
});
