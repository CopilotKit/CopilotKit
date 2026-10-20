import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { z } from "zod";
import type { AnyComponent, UpdateDataModelMessage } from "@a2ui/web_core/v0_9";
import { createCatalog } from "../create-catalog";
import { A2UIProvider, useA2UIActions } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import dashboard from "./fixtures/pni-558-dashboard.json";

const catalog = createCatalog(
  { Metric: { props: z.object({ label: z.string(), value: z.string() }) } },
  {
    Metric: ({ props }) => (
      <p>
        {props.label}: {props.value}
      </p>
    ),
  },
  { includeBasicCatalog: true },
);

function Surface({
  components = dashboard.components,
  data = dashboard.data,
}: {
  components?: AnyComponent[];
  data?: UpdateDataModelMessage["updateDataModel"]["value"];
}) {
  const { processMessages } = useA2UIActions();
  useEffect(() => {
    processMessages([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: dashboard.surfaceId,
          catalogId: catalog.id,
        },
      },
    ]);
  }, [processMessages]);
  useEffect(() => {
    processMessages([
      {
        version: "v0.9",
        updateComponents: { surfaceId: dashboard.surfaceId, components },
      },
    ]);
  }, [components, processMessages]);
  useEffect(() => {
    processMessages([
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: dashboard.surfaceId,
          path: "/",
          value: data,
        },
      },
    ]);
  }, [data, processMessages]);
  return (
    <>
      <input aria-label="Continue conversation" />
      <A2UIRenderer surfaceId={dashboard.surfaceId} />
    </>
  );
}

describe("custom catalog validation", () => {
  it("contains schema-valid malformed function arguments before binder mount", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = render(
        <A2UIProvider catalog={catalog}>
          <Surface
            components={[
              {
                id: "root",
                component: "Text",
                text: { call: "test", args: { argument: { call: "broken" } } },
              },
            ]}
          />
        </A2UIProvider>,
      );
      await act(async () => {});
      expect(screen.getByRole("alert").textContent).toMatch(/Text/);
      view.rerender(
        <A2UIProvider catalog={catalog}>
          <Surface
            components={[{ id: "root", component: "Text", text: "Recovered" }]}
          />
        </A2UIProvider>,
      );
      await act(async () => {});
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Recovered")).toBeTruthy();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("rejects invalid checks before the binder can evaluate them", () => {
    render(
      <A2UIProvider catalog={catalog}>
        <Surface
          components={[
            {
              id: "root",
              component: "TextField",
              label: "Name",
              checks: [null],
            },
          ]}
        />
      </A2UIProvider>,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/checks/);
    expect(
      screen.getByRole("textbox", { name: "Continue conversation" }),
    ).toBeTruthy();
  });

  it("contains an invalid resolved binding and recovers after a data-only correction", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const components = [
        { id: "root", component: "Text", text: { path: "/message" } },
      ];
      const view = render(
        <A2UIProvider catalog={catalog}>
          <Surface
            components={components}
            data={{ message: { invalid: true } }}
          />
        </A2UIProvider>,
      );
      await act(async () => {});
      expect(screen.getByRole("alert").textContent).toMatch(/Text/);
      view.rerender(
        <A2UIProvider catalog={catalog}>
          <Surface components={components} data={{ message: "$327,700" }} />
        </A2UIProvider>,
      );
      await act(async () => {});
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("$327,700")).toBeTruthy();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("contains the saved PNI-558 payload and explains how to recover", () => {
    // Exact render_a2ui arguments from call_25dQx1aDND8JEi4wmPYlEQ6z.
    // The original native history is read-only; no successful result is invented.
    render(
      <A2UIProvider catalog={catalog}>
        <Surface />
      </A2UIProvider>,
    );
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getAllByRole("alert")[0].textContent).toMatch(/Row.*gap/);
    expect(screen.getAllByRole("alert")[0].textContent).toMatch(/try again/i);
  });

  it("rejects the malformed Metric and recovers when corrected on the same surface", async () => {
    const metric = dashboard.components.find(
      (component) => component.id === "metric",
    )!;
    const view = render(
      <A2UIProvider catalog={catalog}>
        <Surface components={[{ ...metric, id: "root" }]} />
      </A2UIProvider>,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /Metric.*label.*value/,
    );
    view.rerender(
      <A2UIProvider catalog={catalog}>
        <Surface
          components={[
            {
              id: "root",
              component: "Metric",
              label: "Revenue",
              value: "$327,700",
            },
          ]}
        />
      </A2UIProvider>,
    );
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Revenue: $327,700")).toBeTruthy();
  });

  it("preserves valid basic data bindings and repeating children", async () => {
    render(
      <A2UIProvider catalog={catalog}>
        <Surface
          components={[
            {
              id: "root",
              component: "Row",
              children: { componentId: "text", path: "/metrics" },
            },
            { id: "text", component: "Text", text: { path: "value" } },
          ]}
        />
      </A2UIProvider>,
    );
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("$327,700")).toBeTruthy();
    expect(screen.getByText("20.3%")).toBeTruthy();
  });
});
