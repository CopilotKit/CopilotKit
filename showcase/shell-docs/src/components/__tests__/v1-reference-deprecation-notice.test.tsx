// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V1ReferenceDeprecationNotice } from "../v1-reference-deprecation-notice";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("V1ReferenceDeprecationNotice", () => {
  it("warns V1 readers and links to the V2 reference", () => {
    render(<V1ReferenceDeprecationNotice version="v1" />);

    expect(
      screen.getByRole("complementary", {
        name: "CopilotKit V1 is deprecated",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This page documents a legacy API and is no longer maintained. Use the V2 reference for current APIs, examples, and guidance.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Go to V2 reference" })
        .getAttribute("href"),
    ).toBe("/reference/v2");
  });

  it("does not render on current reference pages", () => {
    render(<V1ReferenceDeprecationNotice version="v2" />);

    expect(screen.queryByText("CopilotKit V1 is deprecated")).toBeNull();
  });
});
