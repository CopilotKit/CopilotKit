import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealCard } from "../../sales-dashboard/deal-card";
import type { SalesTodo } from "../../../types";

const baseDeal: SalesTodo = {
  id: "1",
  title: "Follow up with Acme Corp",
  stage: "qualified",
  value: 50000,
  dueDate: "2026-04-20",
  assignee: "Alice",
  completed: false,
};

describe("DealCard", () => {
  it("renders deal title", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("Follow up with Acme Corp")).toBeTruthy();
  });

  it("shows stage badge", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("qualified")).toBeTruthy();
  });

  // --- All 6 stage color variants ---

  it("shows correct color class for prospect stage", () => {
    const deal = { ...baseDeal, stage: "prospect" as const };
    const { container } = render(<DealCard deal={deal} />);
    const badge = container.querySelector(".bg-blue-100");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("prospect");
  });

  it("shows correct color class for qualified stage", () => {
    const deal = { ...baseDeal, stage: "qualified" as const };
    const { container } = render(<DealCard deal={deal} />);
    const badge = container.querySelector(".bg-purple-100");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("qualified");
  });

  it("shows correct color class for proposal stage", () => {
    const deal = { ...baseDeal, stage: "proposal" as const };
    const { container } = render(<DealCard deal={deal} />);
    const badge = container.querySelector(".bg-amber-100");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("proposal");
  });

  it("shows correct color class for negotiation stage", () => {
    const deal = { ...baseDeal, stage: "negotiation" as const };
    const { container } = render(<DealCard deal={deal} />);
    const badge = container.querySelector(".bg-orange-100");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("negotiation");
  });

  it("shows correct color class for closed-won stage", () => {
    const deal = { ...baseDeal, stage: "closed-won" as const };
    const { container } = render(<DealCard deal={deal} />);
    const badge = container.querySelector(".bg-green-100");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("closed-won");
  });

  it("shows correct color class for closed-lost stage", () => {
    const deal = { ...baseDeal, stage: "closed-lost" as const };
    const { container } = render(<DealCard deal={deal} />);
    const badge = container.querySelector(".bg-red-100");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("closed-lost");
  });

  // --- Formatted currency ---

  it("shows formatted currency value", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("$50,000")).toBeTruthy();
  });

  it("shows large formatted currency value", () => {
    const deal = { ...baseDeal, value: 1250000 };
    render(<DealCard deal={deal} />);
    expect(screen.getByText("$1,250,000")).toBeTruthy();
  });

  it("shows zero value correctly", () => {
    const deal = { ...baseDeal, value: 0 };
    render(<DealCard deal={deal} />);
    expect(screen.getByText("$0")).toBeTruthy();
  });

  // --- Assignee and due date ---

  it("shows assignee", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("shows due date", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("Due 2026-04-20")).toBeTruthy();
  });

  it("hides assignee when not provided", () => {
    const deal = { ...baseDeal, assignee: "" };
    render(<DealCard deal={deal} />);
    // Empty string is falsy, so assignee span should not render
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("hides due date when not provided", () => {
    const deal = { ...baseDeal, dueDate: "" };
    render(<DealCard deal={deal} />);
    expect(screen.queryByText(/^Due /)).toBeNull();
  });

  // --- Completed state ---

  it("applies reduced opacity when completed", () => {
    const completedDeal = { ...baseDeal, completed: true };
    const { container } = render(<DealCard deal={completedDeal} />);
    expect((container.firstChild as HTMLElement).className).toContain(
      "opacity-60",
    );
  });

  it("does not apply reduced opacity when active", () => {
    const { container } = render(<DealCard deal={baseDeal} />);
    expect((container.firstChild as HTMLElement).className).not.toContain(
      "opacity-60",
    );
  });

  it("shows line-through on title when completed", () => {
    const completedDeal = { ...baseDeal, completed: true };
    render(<DealCard deal={completedDeal} />);
    const title = screen.getByText("Follow up with Acme Corp");
    expect(title.className).toContain("line-through");
  });

  it("does not show line-through on title when active", () => {
    render(<DealCard deal={baseDeal} />);
    const title = screen.getByText("Follow up with Acme Corp");
    expect(title.className).not.toContain("line-through");
  });

  it("shows green indicator dot when active", () => {
    render(<DealCard deal={baseDeal} />);
    const indicator = screen.getByTestId("completion-indicator");
    expect(indicator.className).toContain("bg-green-500");
  });

  it("shows muted indicator dot when completed", () => {
    const completedDeal = { ...baseDeal, completed: true };
    render(<DealCard deal={completedDeal} />);
    const indicator = screen.getByTestId("completion-indicator");
    expect(indicator.className).not.toContain("bg-green-500");
    expect(indicator.className).toContain("bg-[var(--muted-foreground)]");
  });

  it("uses muted-foreground text color for title when completed", () => {
    const completedDeal = { ...baseDeal, completed: true };
    render(<DealCard deal={completedDeal} />);
    const title = screen.getByText("Follow up with Acme Corp");
    expect(title.className).toContain("text-[var(--muted-foreground)]");
  });

  it("has deal-card test id", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByTestId("deal-card")).toBeTruthy();
  });

  it("has stage-badge test id", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByTestId("stage-badge")).toBeTruthy();
  });
});
