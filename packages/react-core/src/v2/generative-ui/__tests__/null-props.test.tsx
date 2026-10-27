import React from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import { withoutRejectedNulls } from "../schema";
import { renderSurface } from "../standard/__tests__/render";

/** A test leaf that shows its optional text, or "unset". */
function Note({ text }: { text?: string }) {
  return <span data-testid="note">{text ?? "unset"}</span>;
}

/** A test leaf with a writable, optional selection. */
function Pick({ selected }: { selected?: string }) {
  return <span data-testid="pick">{selected ?? "none"}</span>;
}

/** A test leaf whose schema accepts null on purpose. */
function Coupon({ code }: { code: string | null }) {
  return <span data-testid="coupon">{code === null ? "no coupon" : code}</span>;
}

const ui = createGenerativeUI({
  id: "test/null-props@1",
  components: {
    Note: { component: Note, props: z.object({ text: z.string().optional() }) },
    Pick: {
      component: Pick,
      props: z.object({ selected: z.string().optional() }),
      writable: ["selected"],
    },
    Coupon: {
      component: Coupon,
      props: z.object({ code: z.string().nullable() }),
    },
  },
});

describe("props set to null", () => {
  it("reads a literal null on an optional prop as an unset prop", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Note", text: null },
    ]);
    expect((await view.findByTestId("note")).textContent).toBe("unset");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("reads a binding to a null value as an unset prop", async () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Pick", selected: { "@path": "/selected" } }],
      { selected: null },
    );
    expect((await view.findByTestId("pick")).textContent).toBe("none");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("keeps null for a prop whose schema accepts it", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Coupon", code: null },
    ]);
    expect((await view.findByTestId("coupon")).textContent).toBe("no coupon");
  });

  it("still rejects a wrong value that is not null", async () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Pick", selected: { "@path": "/selected" } }],
      { selected: 42 },
    );
    expect(await view.findByText(/invalid props/)).toBeTruthy();
    expect(view.queryByTestId("pick")).toBeNull();
  });

  it("drops only the top-level nulls that the schema rejected", () => {
    expect(
      withoutRejectedNulls({ a: null, b: null, c: 1 }, [
        { message: "Expected string", path: ["a"] },
      ]),
    ).toEqual({ b: null, c: 1 });
    expect(
      withoutRejectedNulls({ list: [null] }, [
        { message: "Expected string", path: ["list", 0] },
      ]),
    ).toBeUndefined();
  });

  it("shows the app's fallback, when it set one, instead of the notice", async () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Pick", selected: { "@path": "/selected" } }],
      { selected: 42 },
      { errorFallback: () => <span data-testid="app-fallback" /> },
    );
    expect(await view.findByTestId("app-fallback")).toBeTruthy();
    expect(view.queryByText(/invalid props/)).toBeNull();
  });
});
