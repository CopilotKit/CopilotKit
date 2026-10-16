import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { standardUI } from "../index";
import { renderSurface } from "./render";

/** Tests ported from the a2ui-renderer standard catalog. */

// maplibre-gl is an optional peer dependency. Without it the Map lists its places.
vi.mock("maplibre-gl", () => {
  throw new Error("Cannot find package 'maplibre-gl'");
});

const render = (
  ...args: Parameters<typeof renderSurface> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => renderSurface(standardUI, ...args);

describe("standard catalog: data and media (parity)", () => {
  it("Table renders columns and rows, List renders items", async () => {
    const v = render([
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

  it("Table columns render a { componentId } header cell inside <th>", async () => {
    const v = render([
      {
        id: "root",
        component: "Table",
        columns: [
          "Laptop",
          { label: "Price", componentId: "hb" },
          { componentId: "hb2" },
        ],
        rows: [["Air 13", "$999", "-"]],
        cellComponents: ["hb", "hb2"],
      },
      { id: "hb", component: "Badge", label: "Best value" },
      { id: "hb2", component: "Text", text: "Extra" },
    ]);
    const badge = await v.findByText("Best value");
    const th = badge.closest("th");
    expect(th).not.toBeNull();
    expect(th?.textContent).toContain("Price");
    expect(v.getByText("Extra").closest("th")).not.toBeNull();
  });

  it("TableRow renders its label as a row header cell with labelColSpan", async () => {
    const v = render([
      { id: "root", component: "Table", children: ["r"] },
      {
        id: "r",
        component: "TableRow",
        label: "Day 1",
        labelColSpan: 2,
        children: ["c"],
      },
      { id: "c", component: "TableCell", text: "€80" },
    ]);
    const th = (await v.findByText("Day 1")) as HTMLTableCellElement;
    expect(th.tagName).toBe("TH");
    expect(th.getAttribute("scope")).toBe("row");
    expect(th.colSpan).toBe(2);
  });

  it("ListItem disabled renders at half opacity and ignores its action", async () => {
    const v = render([
      { id: "root", component: "List", children: ["i"] },
      {
        id: "i",
        component: "ListItem",
        label: "Sold out",
        disabled: true,
        action: { event: { name: "pick" } },
      },
    ]);
    const label = await v.findByText("Sold out");
    const li = label.closest("li") as HTMLElement;
    expect(li.getAttribute("aria-disabled")).toBe("true");
    expect(li.style.opacity).toBe("0.5");
    expect(li.querySelector("button")).toBeNull();
    expect(v.forwardEvent).not.toHaveBeenCalled();
  });

  it("List maxMarkerSize and ListItem markerSize size the marker column", async () => {
    const v = render([
      {
        id: "root",
        component: "List",
        marker: "rich",
        maxMarkerSize: 32,
        children: ["a", "b"],
      },
      { id: "a", component: "ListItem", label: "Wide", marker: "①" },
      {
        id: "b",
        component: "ListItem",
        label: "Own",
        marker: "②",
        markerSize: 48,
      },
    ]);
    const wide = (await v.findByText("①")) as HTMLElement;
    expect(wide.style.minWidth).toBe("32px");
    expect(wide.style.maxWidth).toBe("32px");
    expect((v.getByText("②") as HTMLElement).style.minWidth).toBe("48px");
  });

  it("Image, Icon, Favicon, Svg, YouTube, HtmlView render safely", async () => {
    const v = render([
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
      {
        id: "y",
        component: "YouTube",
        videoId: "dQw4w9WgXcQ",
        showThumbnail: false,
      },
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
    await waitFor(() =>
      expect(
        v.container.querySelector("svg.lucide-arrow-right"),
      ).not.toBeNull(),
    );
  });

  it("Image shows the fallback text when the image fails to load", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        src: "https://example.com/missing.png",
        alt: "Missing",
        fallback: "Image unavailable",
      },
    ]);
    fireEvent.error(await v.findByAltText("Missing"));
    expect(await v.findByText("Image unavailable")).not.toBeNull();
  });

  it("Image actionOverlay dispatches its action", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        src: "https://example.com/a.png",
        alt: "A",
        actionOverlay: { label: "Save" },
        onOverlayClick: { event: { name: "save" } },
      },
    ]);
    fireEvent.click(await v.findByRole("button", { name: "Save" }));
    expect(v.forwardEvent.mock.calls[0][0].name).toBe("save");
  });

  it("Image hoverZoom and position apply", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        src: "https://example.com/a.png",
        alt: "Z",
        hoverZoom: true,
        position: "top",
      },
    ]);
    const img = (await v.findByAltText("Z")) as HTMLElement;
    expect(img.style.objectPosition).toBe("top");
    expect(img.style.transition).toContain("transform");
    expect(img.parentElement!.style.overflow).toBe("hidden");
  });

  it("YouTube shows a poster first and loads the player on click", async () => {
    const v = render([
      {
        id: "root",
        component: "YouTube",
        videoId: "dQw4w9WgXcQ",
        title: "Clip",
      },
    ]);
    const play = await v.findByRole("button", { name: "Play Clip" });
    expect(v.container.querySelector("iframe")).toBeNull();
    fireEvent.click(play);
    const iframe = v.container.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toContain("dQw4w9WgXcQ");
    expect(iframe.getAttribute("src")).toContain("autoplay=1");
  });

  it("Svg treats numeric width and height as pixels and takes stroke props", async () => {
    const v = render([
      {
        id: "root",
        component: "Svg",
        viewBox: "0 0 10 10",
        width: 240,
        height: 80,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        preserveAspectRatio: "none",
        circles: [{ cx: 5, cy: 5, r: 4 }],
      },
    ]);
    await waitFor(() =>
      expect(v.container.querySelector("svg")).not.toBeNull(),
    );
    const svg = v.container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("240");
    expect(svg.getAttribute("height")).toBe("80");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("Chart renders a recharts container and Map renders a fallback marker list without maplibre", async () => {
    const v = render([
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

  it("Chart renders pie and line variants with a title", async () => {
    const v = render([
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
        innerRadius: "40%",
        paddingAngle: 2,
      },
      {
        id: "l",
        component: "Chart",
        chartType: "line",
        xKey: "x",
        data: [{ x: 1, y: 2 }],
        series: ["y"],
        stacked: true,
        showDots: true,
      },
    ]);
    expect(await v.findByText("Share")).toBeTruthy();
    expect(v.container.querySelectorAll("[data-a2ui-chart]").length).toBe(2);
    await waitFor(() =>
      expect(
        v.container.querySelectorAll(".recharts-responsive-container").length,
      ).toBe(2),
    );
  });

  it("Chart draws horizontal bars with a value axis label and bounds", async () => {
    const v = render([
      {
        id: "root",
        component: "Chart",
        chartType: "bar",
        layout: "horizontal",
        xKey: "plan",
        data: [
          { plan: "Starter", seats: 10 },
          { plan: "Team", seats: 40 },
        ],
        series: ["seats"],
        yAxis: { label: "Seats", min: 0, max: 50, width: 80 },
        barRadius: 6,
      },
    ]);
    await waitFor(() =>
      expect(
        v.container.querySelector(".recharts-responsive-container"),
      ).not.toBeNull(),
    );
    expect(v.container.querySelector("[data-a2ui-chart=bar]")).not.toBeNull();
    // The hidden data table still lists the categories.
    expect(v.getAllByText("Starter").length).toBeGreaterThan(0);
  });
});
