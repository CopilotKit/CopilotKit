// src/skins/bookstore/components/checkout-card.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CheckoutCard } from "./checkout-card";

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const fillValidCard = () => {
  fill(/card number/i, "4242424242424242");
  fill(/expiry/i, "12/29");
  fill(/security code/i, "311");
};

describe("CheckoutCard — form mode", () => {
  it("shows what is being bought", () => {
    render(
      <CheckoutCard
        mode="form"
        itemCount={2}
        totalCents={3450}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 items/i)).toBeTruthy();
    expect(screen.getByText("$34.50")).toBeTruthy();
  });

  it("hands out ONLY the last four digits — the whole security claim", () => {
    const onSubmit = vi.fn();
    render(
      <CheckoutCard
        mode="form"
        itemCount={1}
        totalCents={1400}
        onSubmit={onSubmit}
      />,
    );
    fillValidCard();
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Exactly one argument, and it is the last four digits. Not the number, not
    // the CVV, not an object that happens to contain them.
    expect(onSubmit.mock.calls[0]).toEqual(["4242"]);
  });

  it("never puts the full number or the CVV anywhere in the DOM after submit", () => {
    render(
      <CheckoutCard
        mode="form"
        itemCount={1}
        totalCents={1400}
        onSubmit={vi.fn()}
      />,
    );
    fillValidCard();
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    expect(document.body.innerHTML).not.toContain("4242424242424242");
    expect(document.body.innerHTML).not.toContain("311");
  });

  it("refuses a short card number without calling onSubmit", () => {
    const onSubmit = vi.fn();
    render(
      <CheckoutCard
        mode="form"
        itemCount={1}
        totalCents={1400}
        onSubmit={onSubmit}
      />,
    );
    fill(/card number/i, "4242");
    fill(/expiry/i, "12/29");
    fill(/security code/i, "311");
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/16 digits/i);
  });

  it("refuses a malformed expiry and a short security code", () => {
    const onSubmit = vi.fn();
    render(
      <CheckoutCard
        mode="form"
        itemCount={1}
        totalCents={1400}
        onSubmit={onSubmit}
      />,
    );
    fill(/card number/i, "4242424242424242");
    fill(/expiry/i, "nope");
    fill(/security code/i, "311");
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    expect(onSubmit).not.toHaveBeenCalled();

    fill(/expiry/i, "12/29");
    fill(/security code/i, "1");
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("tolerates spaces in the typed card number", () => {
    const onSubmit = vi.fn();
    render(
      <CheckoutCard
        mode="form"
        itemCount={1}
        totalCents={1400}
        onSubmit={onSubmit}
      />,
    );
    fill(/card number/i, "4242 4242 4242 4242");
    fill(/expiry/i, "12/29");
    fill(/security code/i, "311");
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    expect(onSubmit).toHaveBeenCalledWith("4242");
  });

  it("uses password inputs so the digits are not projected on stage", () => {
    render(
      <CheckoutCard
        mode="form"
        itemCount={1}
        totalCents={1400}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/card number/i)).toHaveProperty(
      "type",
      "password",
    );
    expect(screen.getByLabelText(/security code/i)).toHaveProperty(
      "type",
      "password",
    );
  });

  it("cannot be submitted twice", () => {
    const onSubmit = vi.fn();
    render(
      <CheckoutCard
        mode="form"
        itemCount={1}
        totalCents={1400}
        onSubmit={onSubmit}
      />,
    );
    fillValidCard();
    const pay = screen.getByRole("button", { name: /pay/i });
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("CheckoutCard — receipt mode (the replay path)", () => {
  it("renders the receipt from a replayed result, not an empty form", () => {
    render(
      <CheckoutCard
        mode="receipt"
        orderId="1042"
        itemCount={2}
        totalCents={3450}
        last4="4242"
      />,
    );
    expect(screen.getByText(/order #1042/i)).toBeTruthy();
    expect(screen.getByText(/•••• 4242/)).toBeTruthy();
    expect(screen.getByText("$34.50")).toBeTruthy();
    // This is what breaks on reload if the render keys off `status`: the answered
    // card falls back to a form (or "Loading…") at exactly the moment beat 2 is
    // being shown.
    expect(screen.queryByLabelText(/card number/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /pay/i })).toBeNull();
  });
});
