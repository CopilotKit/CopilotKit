import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  Box,
  Card,
  Divider,
  Grid,
  GridItem,
  Tabs,
  cardKindOf,
  gapOf,
  gridTemplateColumns,
} from "../layout";

describe("gapOf", () => {
  test.each([
    [undefined, "sm"],
    [0, "none"],
    [1, "sm"],
    [4, "sm"],
    [5, "sm"],
    [6, "lg"],
    [10, "lg"],
  ] as const)("%s → %s", (gap, preset) => {
    expect(gapOf(gap)).toBe(preset);
  });
});

describe("gridTemplateColumns", () => {
  test("two columns by default", () => {
    expect(gridTemplateColumns({})).toContain("/ 2)");
  });

  test("a column count becomes an auto-fit template", () => {
    const template = gridTemplateColumns({ columns: 3 });
    expect(template).toContain("repeat(auto-fit");
    expect(template).toContain("/ 3)");
  });

  test("one column is one track", () => {
    expect(gridTemplateColumns({ columns: 1 })).toBe("minmax(0, 1fr)");
  });

  test("a CSS template passes through", () => {
    expect(gridTemplateColumns({ columns: "2fr 1fr" })).toBe("2fr 1fr");
  });

  test("minChildWidth fills tracks of that width", () => {
    expect(gridTemplateColumns({ minChildWidth: 50 })).toBe(
      "repeat(auto-fill, minmax(min(100%, 200px), 1fr))",
    );
  });
});

describe("cardKindOf", () => {
  test.each([
    [undefined, "layer"],
    ["default", "layer"],
    ["outline", "layer"],
    ["elevated", "layer"],
    ["soft", "layer"],
    ["section", "section"],
    ["transparent", "plain"],
  ] as const)("%s → %s", (variant, kind) => {
    expect(cardKindOf(variant)).toBe(kind);
  });
});

describe("Grid", () => {
  test("renders a Kumo grid with a container-aware template", () => {
    const { container } = render(
      <Grid columns={3}>
        <span>a</span>
      </Grid>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain("gap-3");
    expect(grid.style.gridTemplateColumns).toContain("repeat(auto-fit");
  });

  test("the column template uses the gap of the Kumo preset", () => {
    const { container } = render(
      <Grid columns={2} gap={2}>
        <span>a</span>
      </Grid>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain("1 * 12px");
  });

  test("a GridItem that spans every column takes the full row", () => {
    render(
      <Grid columns={2}>
        <GridItem span={3}>
          <span>wide</span>
        </GridItem>
      </Grid>,
    );
    const item = screen.getByText("wide").parentElement as HTMLElement;
    expect(item.style.gridColumn).toBe("1 / -1");
  });

  test("a smaller span stays a span", () => {
    render(
      <Grid columns={3}>
        <GridItem span={2}>
          <span>two</span>
        </GridItem>
      </Grid>,
    );
    const item = screen.getByText("two").parentElement as HTMLElement;
    expect(item.style.gridColumn).toBe("span 2");
  });
});

describe("Card", () => {
  test("renders the child and the children in a Kumo LayerCard", () => {
    const { container } = render(
      <Card child={<span>first</span>}>
        <span>second</span>
      </Card>,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("ring");
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("second")).toBeTruthy();
  });

  test("a Card inside a Card draws no second box", () => {
    render(
      <Card>
        <Card>
          <span>inner</span>
        </Card>
      </Card>,
    );
    const inner = screen.getByText("inner").parentElement as HTMLElement;
    expect(inner.className).not.toContain("ring");
  });

  test("an outline Card inside a Card keeps its box", () => {
    render(
      <Card>
        <Card variant="outline">
          <span>inner</span>
        </Card>
      </Card>,
    );
    const inner = screen.getByText("inner").parentElement as HTMLElement;
    expect(inner.className).toContain("ring");
  });

  test("the size sets the padding", () => {
    const { container } = render(
      <Card size="lg">
        <span>x</span>
      </Card>,
    );
    expect((container.firstElementChild as HTMLElement).style.padding).toBe(
      "24px",
    );
  });
});

describe("Divider", () => {
  test("is a separator", () => {
    render(<Divider />);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  test("a vertical axis is a vertical separator", () => {
    render(<Divider axis="vertical" />);
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe(
      "vertical",
    );
  });
});

describe("Tabs", () => {
  const tabs = [
    { title: "Specs", child: <p>Specs panel</p> },
    { title: "Reviews", child: <p>Reviews panel</p> },
  ];

  test("shows the panel of the selected tab", () => {
    render(<Tabs tabs={tabs} setSelectedIndex={() => {}} />);
    expect(screen.getByText("Specs panel")).toBeTruthy();
    expect(screen.queryByText("Reviews panel")).toBeNull();
  });

  test("a click selects a tab and calls setSelectedIndex", () => {
    const setSelectedIndex = vi.fn();
    render(<Tabs tabs={tabs} setSelectedIndex={setSelectedIndex} />);
    fireEvent.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(screen.getByText("Reviews panel")).toBeTruthy();
  });

  test("a bound selectedIndex picks the panel", () => {
    render(<Tabs tabs={tabs} selectedIndex={1} setSelectedIndex={() => {}} />);
    expect(screen.getByText("Reviews panel")).toBeTruthy();
  });

  test("renders with no tabs", () => {
    const { container } = render(
      <Tabs tabs={[]} setSelectedIndex={() => {}} />,
    );
    expect(container).toBeTruthy();
  });
});

describe("Box", () => {
  test("a plain Box stays the standard flex container", () => {
    const { container } = render(
      <Box gap={2}>
        <span>a</span>
      </Box>,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.hasAttribute("data-a2ui-std")).toBe(true);
  });

  test("a Box with a border is a Kumo LayerCard", () => {
    const { container } = render(
      <Box border direction="row">
        <span>a</span>
      </Box>,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.hasAttribute("data-a2ui-std")).toBe(false);
    expect(box.className).toContain("ring");
    expect(box.style.flexDirection).toBe("row");
  });

  test("a boxed Box inside a Card is a panel, not a second box", () => {
    render(
      <Card>
        <Box background="surface-secondary">
          <span>inner</span>
        </Box>
      </Card>,
    );
    const box = screen.getByText("inner").parentElement as HTMLElement;
    expect(box.className).not.toContain("ring");
    expect(box.style.background).toBe("var(--a2ui-color-surface-secondary)");
  });
});
