// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EarlyAccessGate } from "../early-access-gate";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function unlock(password: string) {
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
}

test("requires the shared password and remembers it across Trajectories pages", () => {
  const firstPage = render(
    <EarlyAccessGate gate="trajectories">
      <p>First guide</p>
    </EarlyAccessGate>,
  );
  expect(
    screen
      .getByText("First guide")
      .closest("[aria-hidden]")
      ?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(screen.queryByRole("link")).toBeNull();

  unlock("incorrect");
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();

  unlock("earlyaccess");
  expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  expect(
    screen
      .getByText("First guide")
      .closest("[aria-hidden]")
      ?.getAttribute("aria-hidden"),
  ).toBe("false");

  firstPage.unmount();
  render(
    <EarlyAccessGate gate="trajectories">
      <p>Second guide</p>
    </EarlyAccessGate>,
  );
  expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  expect(
    screen
      .getByText("Second guide")
      .closest("[aria-hidden]")
      ?.getAttribute("aria-hidden"),
  ).toBe("false");
});

test("unlocks the current guide when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  render(
    <EarlyAccessGate gate="trajectories">
      <p>Guide</p>
    </EarlyAccessGate>,
  );

  unlock("earlyaccess");
  expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
});
