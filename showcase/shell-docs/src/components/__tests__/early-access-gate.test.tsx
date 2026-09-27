// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EarlyAccessGate } from "../early-access-gate";
import { EARLY_ACCESS_GATES, getEarlyAccessGate } from "@/lib/early-access";

function guide() {
  return (
    <EarlyAccessGate gate="product-trajectories">
      <p>Detailed setup instructions</p>
    </EarlyAccessGate>
  );
}

function enterCode(value: string) {
  const disclosure = screen.getByText("Already have an access code?");
  if (!disclosure.closest("details")?.open) fireEvent.click(disclosure);
  expect(disclosure.closest("details")?.open).toBe(true);
  fireEvent.change(screen.getByLabelText("Access code"), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Read the guide" }));
}

describe("early-access config", () => {
  it("gates product trajectories while keeping released channels public", () => {
    expect(getEarlyAccessGate("product-trajectories")).toBe(
      EARLY_ACCESS_GATES["product-trajectories"],
    );
    expect(getEarlyAccessGate("whatsapp")).toBeNull();
    expect(getEarlyAccessGate("slack")).toBeNull();
    expect(getEarlyAccessGate("teams")).toBeNull();
    expect(getEarlyAccessGate("nope")).toBeNull();
    expect(getEarlyAccessGate(undefined)).toBeNull();
  });
});

describe("EarlyAccessGate", () => {
  const gate = EARLY_ACCESS_GATES["product-trajectories"];

  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("passes children through untouched when no gate is registered", () => {
    const markup = renderToStaticMarkup(
      <EarlyAccessGate gate="whatsapp">
        <p>plain content</p>
      </EarlyAccessGate>,
    );

    expect(markup).toBe("<p>plain content</p>");
  });

  it("renders the application link before JavaScript or storage checks run", () => {
    const markup = renderToStaticMarkup(guide());

    expect(markup).toContain("Apply for early access");
    expect(markup).toContain(
      'href="https://go.copilotkit.ai/product-trajectories-early-access"',
    );
    expect(markup).toContain('aria-hidden="true"');
    // Reusing the existing soft gate deliberately keeps the body in the HTML.
    expect(markup).toContain("Detailed setup instructions");
  });

  it("keeps the guide locked after an incorrect code, then remembers a valid code", () => {
    const view = render(guide());
    expect(
      screen
        .getByRole("link", { name: "Apply for early access" })
        .getAttribute("href"),
    ).toBe(gate.requestUrl);

    enterCode("incorrect-code");
    expect(screen.getByRole("alert").textContent).toContain("didn't work");
    expect(window.localStorage.getItem(gate.storageKey)).toBeNull();
    expect(
      screen
        .getByText("Detailed setup instructions")
        .parentElement?.getAttribute("aria-hidden"),
    ).toBe("true");

    enterCode(gate.password);
    expect(
      screen.queryByRole("link", { name: "Apply for early access" }),
    ).toBeNull();
    expect(
      screen
        .getByText("Detailed setup instructions")
        .parentElement?.getAttribute("aria-hidden"),
    ).toBe("false");
    expect(window.localStorage.getItem(gate.storageKey)).toBe("unlocked");

    view.unmount();
    render(guide());
    expect(
      screen.queryByRole("link", { name: "Apply for early access" }),
    ).toBeNull();
  });

  it("still lets visitors apply and unlock when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    render(guide());

    expect(
      screen.getByRole("link", { name: "Apply for early access" }),
    ).toBeTruthy();
    enterCode(gate.password);
    expect(
      screen.queryByRole("link", { name: "Apply for early access" }),
    ).toBeNull();
    expect(
      screen
        .getByText("Detailed setup instructions")
        .parentElement?.getAttribute("aria-hidden"),
    ).toBe("false");
  });
});
