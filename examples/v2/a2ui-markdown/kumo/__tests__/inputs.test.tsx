import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
// jsdom never finishes the standard Icon's lazy lucide import, so the
// standard Icon is a stub that names the icon it was asked for.
vi.mock("../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../types")>();
  return {
    ...actual,
    standardComponent: (name: string) =>
      name === "Icon"
        ? (props: { name: string }) => <svg data-standard-icon={props.name} />
        : actual.standardComponent(name as never),
  };
});

import {
  Button,
  CheckBox,
  Form,
  Select,
  TextArea,
  TextField,
  buttonSizeOf,
  buttonVariantOf,
  fieldSizeOf,
  inputTypeOf,
} from "../inputs";

const failing = [{ condition: false, message: "Name is required" }];

describe("buttonVariantOf", () => {
  test.each([
    [undefined, undefined, "secondary"],
    ["default", "primary", "secondary"],
    ["soft", undefined, "secondary"],
    ["primary", undefined, "primary"],
    ["primary", "primary", "primary"],
    ["primary", "secondary", "secondary"],
    ["borderless", undefined, "ghost"],
    ["primary", "danger", "destructive"],
    ["default", "danger", "secondary-destructive"],
    ["borderless", "danger", "secondary-destructive"],
  ] as const)("%s %s → %s", (variant, color, kumo) => {
    expect(buttonVariantOf(variant, color)).toBe(kumo);
  });
});

describe("buttonSizeOf", () => {
  test.each([
    [undefined, "base"],
    ["lg", "base"],
    ["md", "sm"],
    ["sm", "xs"],
  ] as const)("%s → %s", (size, kumo) => {
    expect(buttonSizeOf(size)).toBe(kumo);
  });
});

describe("fieldSizeOf", () => {
  test.each([
    [undefined, "base"],
    ["xl", "base"],
    ["lg", "base"],
    ["md", "sm"],
    ["sm", "xs"],
  ] as const)("%s → %s", (size, kumo) => {
    expect(fieldSizeOf(size)).toBe(kumo);
  });
});

describe("inputTypeOf", () => {
  test.each([
    [undefined, "text"],
    ["shortText", "text"],
    ["number", "number"],
    ["email", "email"],
    ["url", "url"],
    ["tel", "tel"],
    ["obscured", "password"],
    ["longText", "textarea"],
  ] as const)("%s → %s", (variant, type) => {
    expect(inputTypeOf(variant)).toBe(type);
  });
});

describe("Button", () => {
  test("calls onClick({}) on click", () => {
    const onClick = vi.fn(async () => ({ ok: true }) as never);
    render(<Button label="Save" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledWith({});
  });

  test("uses text when label is not set", () => {
    render(<Button text="Go" />);
    expect(screen.getByRole("button", { name: "Go" })).toBeTruthy();
  });

  test("a failing check disables it", () => {
    render(<Button label="Submit" submit checks={failing} />);
    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("an href renders a link that opens in a new tab", () => {
    render(<Button label="Docs" href="https://example.com" />);
    const link = screen.getByRole("link", { name: /Docs/ });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("an icon Phosphor lacks falls back to the standard (lucide) Icon", async () => {
    const { container } = render(
      <Button label="Filter" icon="filter" uniform />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-standard-icon="filter"]'),
      ).toBeTruthy(),
    );
  });

  test("renders its child instead of the label", () => {
    render(<Button label="Label" child={<span>Custom</span>} />);
    expect(screen.getByText("Custom")).toBeTruthy();
    expect(screen.queryByText("Label")).toBeNull();
  });
});

describe("Form", () => {
  test("a submit Button sends onSubmit({}) and the page does not reload", () => {
    const onSubmit = vi.fn(async () => ({ ok: true }) as never);
    const { container } = render(
      <Form label="Sign up" onSubmit={onSubmit}>
        <Button label="Create" submit />
      </Form>,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    const isNotPrevented = fireEvent.submit(form);
    expect(isNotPrevented).toBe(false);
    expect(onSubmit).toHaveBeenCalledWith({});
  });
});

describe("TextField", () => {
  test("calls setValue on each keystroke", () => {
    const setValue = vi.fn();
    render(<TextField label="Name" value="" setValue={setValue} />);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Ada" },
    });
    expect(setValue).toHaveBeenCalledWith("Ada");
  });

  test("shows a new bound value", () => {
    const { rerender } = render(
      <TextField label="Name" value="A" setValue={() => {}} />,
    );
    rerender(<TextField label="Name" value="Ada" setValue={() => {}} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada",
    );
  });

  test("hides the check message until blur", () => {
    render(
      <TextField label="Name" value="" checks={failing} setValue={() => {}} />,
    );
    expect(screen.queryByText("Name is required")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Name"));
    expect(screen.getByText("Name is required")).toBeTruthy();
  });

  test("an obscured field stays masked while typing", () => {
    const { rerender } = render(
      <TextField
        label="Password"
        variant="obscured"
        value=""
        setValue={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    rerender(
      <TextField
        label="Password"
        variant="obscured"
        value="secret"
        setValue={() => {}}
      />,
    );
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe(
      "password",
    );
  });

  test("an email field is an email input", () => {
    render(
      <TextField label="Email" variant="email" value="" setValue={() => {}} />,
    );
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
  });

  test("a longText field is a textarea", () => {
    render(
      <TextField
        label="Notes"
        variant="longText"
        value=""
        setValue={() => {}}
      />,
    );
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
  });
});

describe("TextArea", () => {
  test("calls setValue", () => {
    const setValue = vi.fn();
    render(<TextArea label="Notes" value="" setValue={setValue} />);
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Hi" },
    });
    expect(setValue).toHaveBeenCalledWith("Hi");
  });
});

describe("Select", () => {
  test("renders with no options", () => {
    render(<Select label="Goal" setValue={() => {}} />);
    expect(screen.getByText("Goal")).toBeTruthy();
  });

  test("shows the label of the selected option", () => {
    render(
      <Select
        label="Goal"
        value="str"
        options={[{ value: "str", label: "Strength" }, "endurance"]}
        setValue={() => {}}
      />,
    );
    expect(screen.getByText("Strength")).toBeTruthy();
  });
});

describe("CheckBox", () => {
  test("a click calls setValue(true)", () => {
    const setValue = vi.fn();
    render(
      <CheckBox label="Annual billing" value={false} setValue={setValue} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(setValue).toHaveBeenCalledWith(true);
  });
});
