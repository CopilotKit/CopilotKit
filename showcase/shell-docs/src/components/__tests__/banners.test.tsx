// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Banners } from "../banners";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
});

describe("Banners", () => {
  it("promotes Channels and links to its docs", async () => {
    render(<Banners />);

    expect(
      await screen.findByText(
        "The Channels SDK brings your agents where work happens.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Explore Channels/ })
        .getAttribute("href"),
    ).toBe("/channels");
    expect(screen.queryByText(/DeepLearning\.AI/)).toBeNull();
  });
});
