import { describe, expect, it, vi } from "vitest";
import { renderSurface, updateDataModel } from "../../__tests__/render";
import type { SurfaceRender } from "../../__tests__/render";
import { standardUI } from "../index";

const requiredName = {
  condition: {
    "@call": "required",
    args: { value: { "@path": "/form/name" } },
  },
  message: "Name is required",
};

/** The control that `label` labels, through its `for`. */
function byLabel<T extends HTMLElement>(view: SurfaceRender, label: string) {
  const match = [...view.container.querySelectorAll("label")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No label "${label}".`);
  const id = match.getAttribute("for");
  const control = id
    ? view.container.querySelector<T>(`[id="${id}"]`)
    : match.querySelector<T>("input, select, textarea");
  if (!control) throw new Error(`Label "${label}" labels nothing.`);
  return control;
}

function buttonNamed(view: SurfaceRender, name: string) {
  const match = [...view.container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === name,
  );
  if (!match) throw new Error(`No button "${name}".`);
  return match;
}

const alerts = (view: SurfaceRender) =>
  [...view.container.querySelectorAll("[role=alert]")].map((alert) =>
    alert.textContent?.trim(),
  );

function setValue(view: SurfaceRender, input: HTMLInputElement, value: string) {
  input.value = value;
  view.act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
}

/** Leaves the control: the standard controls listen to focusout. */
function blur(view: SurfaceRender, input: HTMLElement) {
  view.act(() =>
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
}

describe("standard catalog: checks", () => {
  it("makes an empty required ChoicePicker fail the Form's validation until a choice is made", () => {
    const v = renderSurface(
      standardUI,
      [
        {
          id: "root",
          component: "Form",
          label: "Order",
          children: ["pick"],
          onSubmit: { event: { name: "order" } },
        },
        {
          id: "pick",
          component: "ChoicePicker",
          label: "Size",
          required: true,
          displayStyle: "chips",
          options: ["S", "M"],
          value: { "@path": "/size" },
        },
      ],
      { size: [] },
    );
    const form = v.container.querySelector("form")!;
    expect(form.checkValidity()).toBe(false);
    v.act(() => buttonNamed(v, "M").click());
    expect(form.checkValidity()).toBe(true);
  });

  it("does not let a disabled required ChoicePicker block the Form", () => {
    const v = renderSurface(
      standardUI,
      [
        { id: "root", component: "Form", label: "Order", children: ["pick"] },
        {
          id: "pick",
          component: "ChoicePicker",
          label: "Size",
          required: true,
          disabled: true,
          options: ["S", "M"],
          value: { "@path": "/size" },
        },
      ],
      { size: [] },
    );
    expect(v.container.querySelector("form")!.checkValidity()).toBe(true);
  });

  it("shows the message of a failed check once the field was touched, and clears it when valid", () => {
    const v = renderSurface(
      standardUI,
      [
        {
          id: "root",
          component: "TextField",
          label: "Name",
          value: { "@path": "/form/name" },
          checks: [requiredName],
        },
      ],
      { form: { name: "" } },
    );
    const input = byLabel<HTMLInputElement>(v, "Name");
    // A fresh form is not red.
    expect(alerts(v)).toEqual([]);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    blur(v, input);
    expect(alerts(v)).toEqual(["Name is required"]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    setValue(v, input, "Ada");
    expect(alerts(v)).toEqual([]);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("uses the default message of the validator when the check has none", () => {
    const v = renderSurface(
      standardUI,
      [
        {
          id: "root",
          component: "TextField",
          label: "Email",
          value: { "@path": "/email" },
          checks: [
            {
              condition: {
                "@call": "email",
                args: { value: { "@path": "/email" } },
              },
            },
          ],
        },
      ],
      { email: "not-an-email" },
    );
    // A field with a value shows its error without a blur.
    expect(alerts(v)).toEqual(["Invalid email address"]);
  });

  it("disables a Button while a check fails and enables it when the data becomes valid", async () => {
    const v = renderSurface(
      standardUI,
      [
        { id: "root", component: "Column", children: ["f", "b"] },
        {
          id: "f",
          component: "TextField",
          label: "Name",
          value: { "@path": "/form/name" },
        },
        {
          id: "b",
          component: "Button",
          label: "Send",
          checks: [requiredName],
          onClick: { event: { name: "send" } },
        },
      ],
      { form: { name: "" } },
    );
    const button = buttonNamed(v, "Send");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Name is required");
    v.act(() => button.click());
    await Promise.resolve();
    expect(v.forwardEvent).not.toHaveBeenCalled();
    setValue(v, byLabel<HTMLInputElement>(v, "Name"), "Ada");
    expect(button.disabled).toBe(false);
    v.act(() => button.click());
    await vi.waitFor(() => expect(v.forwardEvent).toHaveBeenCalled());
  });

  it("shows a warning or an info without making the control invalid or disabling the Button, and keeps the code", () => {
    const v = renderSurface(
      standardUI,
      [
        { id: "root", component: "Column", children: ["f", "b"] },
        {
          id: "f",
          component: "TextField",
          label: "Coupon",
          value: { "@path": "/coupon" },
          checks: [{ condition: { "@path": "/couponCheck" } }],
        },
        {
          id: "b",
          component: "Button",
          label: "Apply",
          checks: [{ condition: { "@path": "/couponCheck" } }],
          onClick: { event: { name: "apply" } },
        },
      ],
      {
        coupon: "OLD10",
        couponCheck: {
          valid: false,
          message: "This coupon expires today",
          code: "EXPIRING",
          severity: "warning",
        },
      },
    );
    const status = v.container.querySelector("[role=status]")!;
    expect(status.textContent?.trim()).toBe("This coupon expires today");
    expect(status.getAttribute("data-a2ui-check-severity")).toBe("warning");
    expect(status.getAttribute("data-a2ui-check-code")).toBe("EXPIRING");
    expect(alerts(v)).toEqual([]);
    expect(
      byLabel<HTMLInputElement>(v, "Coupon").getAttribute("aria-invalid"),
    ).toBeNull();
    const button = buttonNamed(v, "Apply");
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("title")).toBe("This coupon expires today");
    // An error from the same data blocks again.
    v.update(
      updateDataModel("/couponCheck", {
        valid: false,
        message: "Expired",
        severity: "error",
      }),
    );
    expect(alerts(v)).toEqual(["Expired"]);
    expect(button.disabled).toBe(true);
  });

  it("shows the error and blocks when a warning comes before it in the checks", () => {
    const v = renderSurface(
      standardUI,
      [
        {
          id: "root",
          component: "Button",
          label: "Apply",
          checks: [
            { condition: { "@path": "/warn" } },
            { condition: false, message: "Name is required" },
          ],
          onClick: { event: { name: "apply" } },
        },
      ],
      { warn: { valid: false, message: "Expires soon", severity: "warning" } },
    );
    const button = buttonNamed(v, "Apply");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Name is required");
  });

  it("takes a boolean binding as a condition, and a numeric check on a Slider", () => {
    const v = renderSurface(
      standardUI,
      [
        { id: "root", component: "Column", children: ["c", "s"] },
        {
          id: "c",
          component: "CheckBox",
          label: "Accept the terms",
          value: { "@path": "/accepted" },
          checks: [
            { condition: { "@path": "/accepted" }, message: "Please accept" },
          ],
        },
        {
          id: "s",
          component: "Slider",
          label: "Seats",
          min: 0,
          max: 100,
          value: { "@path": "/seats" },
          checks: [
            {
              condition: {
                "@call": "numeric",
                args: { value: { "@path": "/seats" }, min: 1, max: 50 },
              },
            },
          ],
        },
      ],
      { accepted: false, seats: 80 },
    );
    const box = byLabel<HTMLInputElement>(v, "Accept the terms");
    blur(v, box);
    expect(alerts(v)).toEqual(["Please accept", "At most 50"]);
    v.act(() => box.click());
    expect(alerts(v)).toEqual(["At most 50"]);
  });
});
