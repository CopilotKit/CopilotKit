import { beforeAll, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon, loadPhosphor, resolvePhosphorIcon } from "../icons";
import type { PhosphorIcons } from "../icons";

let icons: PhosphorIcons;
// Loading every Phosphor icon is slow on a busy machine.
beforeAll(async () => {
  icons = await loadPhosphor();
}, 60_000);

describe("resolvePhosphorIcon", () => {
  test("maps a lucide name to its Phosphor equivalent", () => {
    expect(resolvePhosphorIcon("mail", icons)).toBe(icons.Envelope);
  });

  test("finds a Phosphor icon with the same name", () => {
    expect(resolvePhosphorIcon("arrow-right", icons)).toBe(icons.ArrowRight);
  });

  test("maps an A2UI icon name to Phosphor", () => {
    expect(resolvePhosphorIcon("favorite", icons)).toBe(icons.Heart);
    expect(resolvePhosphorIcon("arrowBack", icons)).toBe(icons.ArrowLeft);
  });

  test("an unknown name resolves to nothing", () => {
    expect(resolvePhosphorIcon("no-such-icon", icons)).toBeUndefined();
  });
});

describe("Icon", () => {
  test("renders a Phosphor svg named by label", async () => {
    render(<Icon name="mail" label="Email" />);
    const svg = await screen.findByRole("img", { name: "Email" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  test("is hidden from screen readers without a label", async () => {
    const { container } = render(<Icon name="coffee" />);
    await screen.findByText((_, element) => element?.tagName === "svg");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
