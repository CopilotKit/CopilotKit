import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Lightbox } from "../Lightbox";

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open preview
      </button>
      {open && (
        <Lightbox onClose={() => setOpen(false)} label="cat.png">
          <a href="#full">Full size</a>
        </Lightbox>
      )}
    </>
  );
}

function openPreview() {
  render(<Opener />);
  const opener = screen.getByRole("button", { name: "Open preview" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Lightbox", () => {
  it("is a modal dialog named by its label, with focus on the close button", () => {
    openPreview();

    const dialog = screen.getByRole("dialog", { name: "cat.png" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close preview" }),
    );
  });

  it("keeps Tab inside the dialog", () => {
    openPreview();
    const dialog = screen.getByRole("dialog");
    screen.getByRole("link", { name: "Full size" }).focus();

    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close preview" }),
    );
  });

  it("returns focus to the opener when it closes", () => {
    const opener = openPreview();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
