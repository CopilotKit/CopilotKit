import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderStandard } from "./standard-test-utils";

describe("standard catalog: data and media", () => {
  it("Table renders columns and rows, List renders items", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["t", "l"] },
      {
        id: "t",
        component: "Table",
        columns: ["Feature", "Team"],
        rows: [
          ["Price", "$29/seat"],
          ["Seats", "Custom"],
        ],
      },
      {
        id: "l",
        component: "List",
        items: ["one", { label: "two", description: "second" }],
        marker: "number",
      },
    ]);
    expect(await v.findByText("$29/seat")).toBeTruthy();
    expect(v.container.querySelectorAll("th").length).toBe(2);
    expect(v.getByText("second")).toBeTruthy();
    expect(v.container.querySelector("ol")).not.toBeNull();
  });

  it("Table also accepts TableRow/TableCell children with template repetition", async () => {
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Table",
          children: { componentId: "row", path: "/rows" },
        },
        { id: "row", component: "TableRow", children: ["c"] },
        { id: "c", component: "TableCell", children: ["x"] },
        { id: "x", component: "Text", text: { path: "name" } },
      ],
      { rows: [{ name: "Alpha" }, { name: "Beta" }] },
    );
    expect(await v.findByText("Beta")).toBeTruthy();
    expect(v.getByText("Alpha")).toBeTruthy();
    expect(v.container.querySelectorAll("tr").length).toBe(2);
  });

  it("Table shows emptyLabel when there are no rows", async () => {
    const v = renderStandard([
      { id: "root", component: "Table", columns: ["A"], rows: [] },
    ]);
    expect(await v.findByText("No rows")).toBeTruthy();
  });

  it("List renders template children when items are absent", async () => {
    const v = renderStandard(
      [
        {
          id: "root",
          component: "List",
          children: { componentId: "li", path: "/todos" },
        },
        { id: "li", component: "ListItem", label: { path: "title" } },
      ],
      { todos: [{ title: "Buy milk" }, { title: "Walk dog" }] },
    );
    expect(await v.findByText("Walk dog")).toBeTruthy();
    expect(v.container.querySelector("ul")).not.toBeNull();
    expect(v.container.querySelectorAll("li").length).toBe(2);
  });

  it("List item action dispatches the A2UI action", async () => {
    const actions: unknown[] = [];
    const v = renderStandard(
      [
        {
          id: "root",
          component: "List",
          items: [
            {
              label: "Pick me",
              action: { event: { name: "pick", context: { id: "1" } } },
            },
          ],
        },
      ],
      undefined,
      (a) => {
        actions.push(a);
      },
    );
    fireEvent.click(await v.findByText("Pick me"));
    expect(actions.length).toBe(1);
  });

  it("Image, Icon, Favicon, Svg, YouTube, HtmlView render safely", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Column",
        children: ["i", "c", "f", "s", "y", "h"],
      },
      {
        id: "i",
        component: "Image",
        src: "https://example.com/a.png",
        alt: "pic",
        aspectRatio: "16/9",
        radius: "lg",
      },
      { id: "c", component: "Icon", name: "arrow-right", size: "md" },
      {
        id: "f",
        component: "Favicon",
        url: "https://copilotkit.ai",
        alt: "ck",
      },
      {
        id: "s",
        component: "Svg",
        viewBox: "0 0 10 10",
        paths: [{ d: "M0 0L10 10", stroke: "danger" }],
      },
      { id: "y", component: "YouTube", videoId: "dQw4w9WgXcQ" },
      {
        id: "h",
        component: "HtmlView",
        html: "<b>hi</b><script>window.__x=1</script>",
        height: 100,
      },
    ]);
    expect((await v.findByAltText("pic")).getAttribute("src")).toContain(
      "a.png",
    );
    expect(v.container.querySelector("svg")).not.toBeNull();
    const iframes = v.container.querySelectorAll("iframe");
    expect(iframes.length).toBe(2);
    expect(iframes[1].getAttribute("sandbox")).toBe("");
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
    expect(iframes[0].getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(v.getByAltText("ck").getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?domain=copilotkit.ai&sz=64",
    );
    expect(v.container.querySelector("path[d='M0 0L10 10']")).not.toBeNull();
    expect(v.container.querySelector("svg.lucide-arrow-right")).not.toBeNull();
  });

  it("Icon with an unknown name renders nothing", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["c", "t"] },
      { id: "c", component: "Icon", name: "definitely-not-an-icon" },
      { id: "t", component: "Text", text: "after" },
    ]);
    expect(await v.findByText("after")).toBeTruthy();
    expect(v.container.querySelector("svg")).toBeNull();
  });

  it("YouTube ignores a videoId that is not a plain id", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["y", "t"] },
      { id: "y", component: "YouTube", videoId: "../../evil?x=1" },
      { id: "t", component: "Text", text: "after" },
    ]);
    expect(await v.findByText("after")).toBeTruthy();
    expect(v.container.querySelector("iframe")).toBeNull();
  });

  it("Chart renders a recharts container and Map renders a fallback marker list without maplibre", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["c", "m"] },
      {
        id: "c",
        component: "Chart",
        chartType: "bar",
        xKey: "month",
        data: [
          { month: "Jan", cost: 290 },
          { month: "Feb", cost: 580 },
        ],
        series: ["cost"],
        height: 200,
      },
      {
        id: "m",
        component: "Map",
        markers: [{ label: "Vienna", lat: 48.2, lng: 16.4 }],
        height: 200,
      },
    ]);
    expect(await v.findByText("Vienna")).toBeTruthy();
    expect(v.container.querySelector("[data-a2ui-chart]")).not.toBeNull();
  });

  it("Map marker list writes the selected label back to the data model", async () => {
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["m", "t"] },
        {
          id: "m",
          component: "Map",
          markers: [
            { label: "Vienna", lat: 48.2, lng: 16.37 },
            { label: "Graz", lat: 47.07, lng: 15.44 },
          ],
          selected: { path: "/city" },
        },
        { id: "t", component: "Text", text: { path: "/city" } },
      ],
      { city: "none" },
    );
    fireEvent.click(await v.findByText("Graz"));
    await waitFor(() =>
      expect(v.getAllByText("Graz").length).toBeGreaterThan(1),
    );
  });

  it("Chart renders pie and line variants with a title", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["p", "l"] },
      {
        id: "p",
        component: "Chart",
        chartType: "donut",
        title: "Share",
        xKey: "name",
        data: [
          { name: "A", value: 1 },
          { name: "B", value: 2 },
        ],
        series: [{ key: "value", label: "Value" }],
      },
      {
        id: "l",
        component: "Chart",
        chartType: "line",
        xKey: "x",
        data: [{ x: 1, y: 2 }],
        series: ["y"],
        stacked: true,
      },
    ]);
    expect(await v.findByText("Share")).toBeTruthy();
    expect(v.container.querySelectorAll("[data-a2ui-chart]").length).toBe(2);
    // recharts is lazy-loaded; its container appears once the import resolves.
    await waitFor(() =>
      expect(
        v.container.querySelectorAll(".recharts-responsive-container").length,
      ).toBe(2),
    );
  });
});
