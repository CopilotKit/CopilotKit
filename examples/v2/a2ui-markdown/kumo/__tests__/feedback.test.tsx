import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FlashcardFlip } from "../feedback";

describe("FlashcardFlip", () => {
  test("shows the front and the hint", () => {
    render(<FlashcardFlip front="Hola" back="Hello" hint="Click to flip" />);
    const card = screen.getByRole("button", { name: /Hola/ });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Click to flip")).toBeTruthy();
  });

  test("a click flips it to the back", () => {
    render(<FlashcardFlip front="Hola" back="Hello" hint="Click to flip" />);
    fireEvent.click(screen.getByRole("button", { name: /Hola/ }));
    const card = screen.getByRole("button", { name: /Hello/ });
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });
});
