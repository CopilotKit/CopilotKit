import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, TableCell, TableRow, TableSection } from "../table";

describe("Table with rows and columns", () => {
  test("renders column headers and cells", () => {
    render(
      <Table
        columns={["Name", { label: "Price", align: "end" }]}
        rows={[["Laptop", 1299]]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Laptop" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "1299" })).toBeTruthy();
  });

  test("columnSizing equal sets a fixed layout", () => {
    render(<Table columns={["A"]} rows={[["x"]]} columnSizing="equal" />);
    expect(screen.getByRole("table").className).toContain("table-fixed");
  });

  test("no rows shows the emptyLabel", () => {
    render(<Table columns={["A"]} rows={[]} emptyLabel="Nothing yet" />);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
  });

  test("a componentId cell shows the matching cellComponents element", () => {
    render(
      <Table
        columns={["Pick"]}
        rows={[[{ componentId: "best" }]]}
        cellComponents={[<span key="best">Best value</span>]}
      />,
    );
    expect(screen.getByText("Best value")).toBeTruthy();
  });

  test("renders while the props stream in", () => {
    render(<Table />);
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("Table with children", () => {
  test("a header section renders column headers", () => {
    render(
      <Table>
        <TableSection header>
          <TableRow>
            <TableCell text="Name" />
          </TableRow>
        </TableSection>
        <TableSection>
          <TableRow label="Row 1">
            <TableCell text="Ada" colSpan={2} />
          </TableRow>
        </TableSection>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Row 1" })).toBeTruthy();
    expect(
      screen.getByRole("cell", { name: "Ada" }).getAttribute("colspan"),
    ).toBe("2");
  });

  test("a row outside a section sits in a tbody", () => {
    const { container } = render(
      <Table>
        <TableRow>
          <TableCell text="Loose" />
        </TableRow>
      </Table>,
    );
    expect(container.querySelector("tbody tr")).toBeTruthy();
  });
});
