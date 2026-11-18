import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import type { PropType } from "vue";
import { z } from "zod";
import { withoutRejectedNulls } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../../catalog";
import { renderSurface } from "../../__tests__/helpers/render-surface";

// The port of React's `__tests__/null-props.test.tsx`. React keeps it next
// to the engine tests; it renders through the standard test helper, so the
// Vue port lives with the standard tests.

/** A test leaf that shows its optional text, or "unset". */
const Note = defineComponent({
  props: { text: String },
  template: `<span data-testid="note">{{ text ?? "unset" }}</span>`,
});

/** A test leaf with a writable, optional selection. */
const Pick = defineComponent({
  props: { selected: String },
  emits: ["update:selected"],
  template: `<span data-testid="pick">{{ selected ?? "none" }}</span>`,
});

/** A test leaf whose schema accepts null on purpose. */
const Coupon = defineComponent({
  // No default: a dropped null would render as an empty span, not "no coupon".
  props: { code: String as PropType<string | null> },
  template: `<span data-testid="coupon">{{ code === null ? "no coupon" : code }}</span>`,
});

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
});
