import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@cloudflare/kumo";
import {
  Modal,
  Popover,
  PopoverContent,
  PopoverTrigger,
  dialogSizeOf,
} from "../overlays";

describe("dialogSizeOf", () => {
  test.each([
    [undefined, "base"],
    [70, "sm"],
    [100, "base"],
    [140, "lg"],
    [200, "xl"],
    ["300px", "sm"],
    ["560px", "lg"],
    ["50%", "base"],
  ] as const)("%s → %s", (maxWidth, size) => {
    expect(dialogSizeOf(maxWidth)).toBe(size);
  });
});

describe("Popover", () => {
  test("a click on the trigger opens it and calls setOpen(true)", () => {
    const setOpen = vi.fn();
    render(
      <Popover setOpen={setOpen}>
        <PopoverTrigger>
          <span>Details</span>
        </PopoverTrigger>
        <PopoverContent>
          <p>More info</p>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText("More info")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(setOpen).toHaveBeenCalledWith(true);
    expect(screen.getByText("More info")).toBeTruthy();
  });

  test("a bound open shows the content", () => {
    render(
      <Popover open setOpen={() => {}}>
        <PopoverTrigger>
          <span>Details</span>
        </PopoverTrigger>
        <PopoverContent>
          <p>More info</p>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.getByText("More info")).toBeTruthy();
  });
});

describe("Modal", () => {
  test("a Button trigger is not nested in another button", () => {
    const { container } = render(
      <Modal
        trigger={<Button>Open</Button>}
        content={<p>Body</p>}
        setOpen={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    expect(container.querySelectorAll('[role="button"] button')).toHaveLength(
      0,
    );
  });

  test("a click on the trigger opens the dialog", () => {
    const setOpen = vi.fn();
    render(
      <Modal
        title="Terms"
        trigger={<Button>Open</Button>}
        content={<p>Body</p>}
        setOpen={setOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(setOpen).toHaveBeenCalledWith(true);
    expect(screen.getByRole("dialog", { name: "Terms" })).toBeTruthy();
  });

  test("a text trigger is a button for the keyboard", () => {
    render(
      <Modal
        trigger={<span>Read more</span>}
        content={<p>Body</p>}
        setOpen={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Read more" })).toBeTruthy();
  });

  test("Escape closes it with setOpen(false)", () => {
    const setOpen = vi.fn();
    render(
      <Modal
        open
        title="Terms"
        trigger={<Button>Open</Button>}
        content={<p>Body</p>}
        setOpen={setOpen}
      />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(setOpen).toHaveBeenCalledWith(false);
  });
});
