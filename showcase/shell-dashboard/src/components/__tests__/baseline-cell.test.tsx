import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BaselineCellView } from "../baseline-cell";

describe("BaselineCellView", () => {
  it("renders works status with checkmark emoji", () => {
    render(<BaselineCellView status="works" tags={[]} />);
    expect(screen.getByText("✅")).toBeInTheDocument();
  });

  it("renders possible with tag badges (data-tag attributes present)", () => {
    render(<BaselineCellView status="possible" tags={["cpk", "agui"]} />);
    expect(screen.getByText("🛠️")).toBeInTheDocument();
    expect(screen.getByTestId("tag-badge-cpk")).toBeInTheDocument();
    expect(screen.getByTestId("tag-badge-agui")).toBeInTheDocument();
  });

  it("renders impossible with X emoji", () => {
    render(<BaselineCellView status="impossible" tags={[]} />);
    expect(screen.getByText("❌")).toBeInTheDocument();
  });

  it("renders unknown with question mark", () => {
    render(<BaselineCellView status="unknown" tags={[]} />);
    expect(screen.getByText("❓")).toBeInTheDocument();
  });

  it("renders all tag as star badge", () => {
    render(<BaselineCellView status="possible" tags={["all"]} />);
    const badge = screen.getByTestId("tag-badge-all");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("✱");
  });

  it("does not render badges when status is works", () => {
    render(<BaselineCellView status="works" tags={[]} />);
    const badges = screen.queryAllByTestId(/^tag-badge-/);
    expect(badges).toHaveLength(0);
  });

  it("applies cursor-pointer class when editing=true", () => {
    const { container } = render(
      <BaselineCellView status="works" tags={[]} editing={true} />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("cursor-pointer");
  });

  it("does not apply cursor-pointer when editing is false/undefined", () => {
    const { container: c1 } = render(
      <BaselineCellView status="works" tags={[]} editing={false} />,
    );
    expect(c1.firstElementChild?.className).not.toContain("cursor-pointer");

    const { container: c2 } = render(
      <BaselineCellView status="works" tags={[]} />,
    );
    expect(c2.firstElementChild?.className).not.toContain("cursor-pointer");
  });
});
