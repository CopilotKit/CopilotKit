// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessGate } from "./AccessGate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AccessGate", () => {
  it("exchanges the code and reloads after authentication", async () => {
    const fetchAccess = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchAccess);
    const onAuthenticated = vi.fn();
    render(<AccessGate onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText("Access code"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open CloudPlot" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(fetchAccess).toHaveBeenCalledWith(
      "/api/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accessCode: "correct horse" }),
      }),
    );
  });

  it("shows a rejection without authenticating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Invalid access code." }, { status: 401 }),
      ),
    );
    const onAuthenticated = vi.fn();
    render(<AccessGate onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText("Access code"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open CloudPlot" }));

    expect(await screen.findByText("Invalid access code.")).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
