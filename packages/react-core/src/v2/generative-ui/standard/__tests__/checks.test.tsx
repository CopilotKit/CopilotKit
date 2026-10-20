import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { standardUI } from "../index";
import { renderSurface } from "./render";

const requiredName = {
  condition: {
    "@call": "required",
    args: { value: { "@path": "/form/name" } },
  },
  message: "Name is required",
};

describe("standard catalog: checks", () => {
  it("makes an empty required ChoicePicker fail the Form's validation until a choice is made", async () => {
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
    const form = (await v.findByRole("form")) as HTMLFormElement;
    expect(form.checkValidity()).toBe(false);
    fireEvent.click(v.getByRole("button", { name: "M" }));
    await waitFor(() => expect(form.checkValidity()).toBe(true));
  });

  it("does not let a disabled required ChoicePicker block the Form", async () => {
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
    const form = (await v.findByRole("form")) as HTMLFormElement;
    expect(form.checkValidity()).toBe(true);
  });

  it("shows the message of a failed check once the field was touched, and clears it when valid", async () => {
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
    const input = await v.findByLabelText("Name");
    // A fresh form is not red.
    expect(v.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.blur(input);
    expect((await v.findByRole("alert")).textContent).toBe("Name is required");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "Ada" } });
    await waitFor(() => expect(v.queryByRole("alert")).toBeNull());
    expect(v.getByLabelText("Name").getAttribute("aria-invalid")).toBeNull();
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("uses the default message of the validator when the check has none", async () => {
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
    expect((await v.findByRole("alert")).textContent).toBe(
      "Invalid email address",
    );
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
    const button = (await v.findByRole("button", {
      name: "Send",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Name is required");
    fireEvent.click(button);
    expect(v.forwardEvent).not.toHaveBeenCalled();
    fireEvent.change(v.getByLabelText("Name"), { target: { value: "Ada" } });
    await waitFor(() =>
      expect(
        (v.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(v.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(v.forwardEvent).toHaveBeenCalled());
  });

  it("takes a boolean binding as a condition, and a numeric check on a Slider", async () => {
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
    const box = await v.findByLabelText("Accept the terms");
    fireEvent.blur(box);
    expect((await v.findAllByRole("alert")).map((a) => a.textContent)).toEqual([
      "Please accept",
      "At most 50",
    ]);
    fireEvent.click(box);
    await waitFor(() =>
      expect(v.getAllByRole("alert").map((a) => a.textContent)).toEqual([
        "At most 50",
      ]),
    );
  });
});
