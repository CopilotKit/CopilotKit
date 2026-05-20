/**
 * Unit tests for BaselinePopover — status selector + tag toggles.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BaselinePopover } from "../baseline-popover";
import type { BaselineStatus, BaselineTag } from "../../lib/baseline-types";

function renderPopover(
  overrides: {
    status?: BaselineStatus;
    tags?: BaselineTag[];
    onSave?: (s: BaselineStatus, t: BaselineTag[]) => void;
    onClose?: () => void;
  } = {},
) {
  const onSave = overrides.onSave ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  return render(
    <BaselinePopover
      status={overrides.status ?? "works"}
      tags={overrides.tags ?? []}
      onSave={onSave}
      onClose={onClose}
    />,
  );
}

describe("BaselinePopover", () => {
  it("renders all 4 status buttons", () => {
    const { getByTestId } = renderPopover();
    expect(getByTestId("status-works")).toBeInTheDocument();
    expect(getByTestId("status-possible")).toBeInTheDocument();
    expect(getByTestId("status-impossible")).toBeInTheDocument();
    expect(getByTestId("status-unknown")).toBeInTheDocument();
  });

  it("tags row is disabled (opacity-20) when status is 'works'", () => {
    const { getByTestId } = renderPopover({ status: "works" });
    const tagsRow = getByTestId("tags-row");
    expect(tagsRow.className).toContain("opacity-20");
    expect(tagsRow.className).toContain("pointer-events-none");
  });

  it("tags row is enabled when status is 'possible'", () => {
    const { getByTestId } = renderPopover({
      status: "possible",
      tags: ["all"],
    });
    const tagsRow = getByTestId("tags-row");
    expect(tagsRow.className).not.toContain("opacity-20");
    expect(tagsRow.className).not.toContain("pointer-events-none");
  });

  it("toggling a tag updates visual state", () => {
    const { getByTestId } = renderPopover({
      status: "possible",
      tags: ["all"],
    });

    // Initially "all" is selected → opacity-100
    const allBtn = getByTestId("tag-all");
    expect(allBtn.className).toContain("opacity-100");

    // Click "cpk" → should become selected, "all" should lose selection
    fireEvent.click(getByTestId("tag-cpk"));
    const cpkBtn = getByTestId("tag-cpk");
    expect(cpkBtn.className).toContain("opacity-100");
    expect(getByTestId("tag-all").className).toContain("opacity-30");
  });

  it("renders all 7 tag buttons", () => {
    const { getByTestId } = renderPopover({
      status: "possible",
      tags: ["all"],
    });
    expect(getByTestId("tag-all")).toBeInTheDocument();
    expect(getByTestId("tag-cpk")).toBeInTheDocument();
    expect(getByTestId("tag-agui")).toBeInTheDocument();
    expect(getByTestId("tag-int")).toBeInTheDocument();
    expect(getByTestId("tag-demo")).toBeInTheDocument();
    expect(getByTestId("tag-docs")).toBeInTheDocument();
    expect(getByTestId("tag-tests")).toBeInTheDocument();
  });
});
