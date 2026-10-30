import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@cloudflare/kumo";
import { ShikiProvider } from "@cloudflare/kumo/code";
import { Button } from "@cloudflare/kumo";
import {
  Badge,
  Blockquote,
  Caption,
  Code,
  Link,
  ShimmerText,
  Text,
  Title,
  Tooltip,
  badgeVariantOf,
  textSizeOf,
  textVariantOf,
  titleVariantOf,
} from "../text";

describe("titleVariantOf", () => {
  test.each([
    ["sm", { variant: "heading" }],
    ["md", { variant: "heading" }],
    ["lg", { variant: "heading", size: "lg" }],
    ["xl", { variant: "heading", size: "lg" }],
    ["2xl", { variant: "heading2" }],
    ["3xl", { variant: "heading1" }],
    ["5xl", { variant: "heading1" }],
  ] as const)("%s", (size, expected) => {
    expect(titleVariantOf(size)).toEqual(expected);
  });
});

describe("textVariantOf", () => {
  test.each([
    [undefined, "body"],
    ["default", "body"],
    ["secondary", "secondary"],
    ["tertiary", "secondary"],
    ["danger", "error"],
    ["success", "body"],
    ["info", "body"],
  ] as const)("%s → %s", (color, variant) => {
    expect(textVariantOf(color)).toBe(variant);
  });
});

describe("textSizeOf", () => {
  test.each([
    [undefined, undefined],
    ["3xs", "xs"],
    ["2xs", "xs"],
    ["xs", "xs"],
    ["sm", "sm"],
    ["md", "base"],
    ["lg", "lg"],
  ] as const)("%s → %s", (size, kumo) => {
    expect(textSizeOf(size)).toBe(kumo);
  });
});

describe("badgeVariantOf", () => {
  test.each([
    ["secondary", "outline", "outline"],
    ["danger", "outline", "outline"],
    [undefined, undefined, "secondary"],
    ["secondary", "soft", "secondary"],
    ["success", "soft", "success"],
    ["danger", "soft", "error"],
    ["warning", "soft", "warning"],
    ["info", "soft", "info"],
    ["discovery", "soft", "purple"],
    ["secondary", "solid", "neutral"],
    ["success", "solid", "green"],
    ["danger", "solid", "red"],
    ["warning", "solid", "orange"],
    ["info", "solid", "blue"],
    ["discovery", "solid", "purple"],
  ] as const)("%s %s → %s", (color, variant, kumo) => {
    expect(badgeVariantOf(color, variant)).toBe(kumo);
  });
});

describe("Title", () => {
  test("uses the heading tag of its size", () => {
    render(<Title text="Revenue" size="md" />);
    expect(
      screen.getByRole("heading", { level: 3, name: "Revenue" }),
    ).toBeTruthy();
  });
});

describe("Text", () => {
  test("renders inline markdown", () => {
    render(<Text text="A **bold** move" />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  test("a markdown link opens in a new tab", () => {
    render(<Text text="See [docs](https://example.com)" />);
    const link = screen.getByRole("link", { name: /docs/ });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("an unsafe link shows only its label", () => {
    render(<Text text="[click](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("click")).toBeTruthy();
  });

  test("a success color uses the success token", () => {
    render(<Text text="Paid" color="success" />);
    expect(screen.getByText("Paid").style.color).toBe(
      "var(--a2ui-color-text-success)",
    );
  });

  test("renders its children after the text", () => {
    render(<Text text="Status">{<span>live</span>}</Text>);
    expect(screen.getByText("live")).toBeTruthy();
  });

  test("a bound number shows as text", () => {
    render(<Text text={42} />);
    expect(screen.getByText("42")).toBeTruthy();
  });
});

describe("Caption", () => {
  test("renders its text", () => {
    render(<Caption text="Updated now" />);
    expect(screen.getByText("Updated now")).toBeTruthy();
  });
});

describe("Badge", () => {
  test("renders its label", () => {
    render(<Badge label="Best value" color="success" />);
    expect(screen.getByText("Best value")).toBeTruthy();
  });
});

describe("Link", () => {
  test("opens an absolute URL in a new tab", () => {
    render(<Link text="Docs" href="https://example.com" />);
    const link = screen.getByRole("link", { name: /Docs/ });
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("an unsafe URL renders no link", () => {
    render(<Link text="Bad" href="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Bad")).toBeTruthy();
  });
});

function WithShiki({ children }: { children: ReactNode }) {
  return (
    <ShikiProvider engine="javascript" languages={["tsx"]}>
      {children}
    </ShikiProvider>
  );
}

describe("Code", () => {
  test("renders the source of an unknown language", () => {
    render(
      <WithShiki>
        <Code text="qapla'" language="klingon" />
      </WithShiki>,
    );
    expect(screen.getByText(/qapla/)).toBeTruthy();
  });
});

describe("Tooltip", () => {
  test("a Button trigger is not nested in another button", () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip trigger={<Button>Save</Button>} content={<span>Saves</span>} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(container.querySelectorAll("button button")).toHaveLength(0);
  });
});

describe("Blockquote", () => {
  test("is a blockquote with inline markdown", () => {
    const { container } = render(<Blockquote text="Less is **more**" />);
    expect(container.querySelector("blockquote")).toBeTruthy();
    expect(screen.getByText("more").tagName).toBe("STRONG");
  });
});

describe("ShimmerText", () => {
  test("shows the text next to a Kumo loader", () => {
    render(<ShimmerText text="Searching flights" />);
    expect(screen.getByText("Searching flights")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
