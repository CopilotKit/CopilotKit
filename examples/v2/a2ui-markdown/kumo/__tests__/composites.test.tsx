import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  Citation,
  EntityCard,
  FollowUp,
  ImageGrid,
  LinkCard,
  entityActionVariantOf,
} from "../composites";

const ok = async () => ({ ok: true }) as never;

describe("FollowUp", () => {
  test("a string pill sends its own text", () => {
    const onFollowUp = vi.fn(ok);
    render(
      <FollowUp
        title="Ask next"
        items={["Show more"]}
        onFollowUp={onFollowUp}
      />,
    );
    expect(screen.getByText("Ask next")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(onFollowUp).toHaveBeenCalledWith({ message: "Show more" });
  });

  test("a pill with a message sends the message", () => {
    const onFollowUp = vi.fn(ok);
    render(
      <FollowUp
        items={[{ label: "Cheaper", message: "Show cheaper options" }]}
        onFollowUp={onFollowUp}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cheaper/ }));
    expect(onFollowUp).toHaveBeenCalledWith({
      message: "Show cheaper options",
    });
  });

  test("an unbound FollowUp is the standard one, which sends the follow-up itself", () => {
    const { container } = render(<FollowUp items={["Show more"]} />);
    expect(container.querySelector("[data-a2ui-follow-up]")).toBeTruthy();
  });

  test("renders with no items", () => {
    const { container } = render(<FollowUp />);
    expect(container).toBeTruthy();
  });
});

describe("entityActionVariantOf", () => {
  test.each([
    ["solid", false, "primary"],
    ["soft", false, "secondary"],
    ["outline", false, "outline"],
    ["ghost", true, "ghost"],
    [undefined, true, "outline"],
    [undefined, false, "ghost"],
  ] as const)("%s (handler %s) → %s", (variant, hasHandler, kumo) => {
    expect(entityActionVariantOf(variant, hasHandler)).toBe(kumo);
  });
});

describe("EntityCard", () => {
  test("an action without href sends onAction({ label })", () => {
    const onAction = vi.fn(ok);
    render(
      <EntityCard
        title="Café Central"
        actions={[{ label: "Reserve" }]}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    expect(onAction).toHaveBeenCalledWith({ label: "Reserve" });
  });

  test("an action with href is a link that opens in a new tab", () => {
    render(
      <EntityCard
        title="Café Central"
        actions={[{ label: "Website", href: "https://example.com" }]}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Website/ }).getAttribute("target"),
    ).toBe("_blank");
  });

  test("a clickable card is a link the keyboard can open", () => {
    const onClick = vi.fn(ok);
    render(<EntityCard title="Café Central" onClick={onClick} />);
    const card = screen.getByRole("link", { name: /Café Central/ });
    expect(card.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onClick).toHaveBeenCalledWith({});
  });

  test("shows the subtitle, meta, badge and rating", () => {
    render(
      <EntityCard
        title="Café Central"
        subtitle="Vienna"
        meta="Open until 22:00"
        badge={{ label: "Popular", color: "success" }}
        rating={4.5}
        ratingCount={120}
      />,
    );
    expect(screen.getByText("Vienna")).toBeTruthy();
    expect(screen.getByText("Open until 22:00")).toBeTruthy();
    expect(screen.getByText("Popular")).toBeTruthy();
    expect(screen.getByLabelText("Rated 4.5 out of 5")).toBeTruthy();
    expect(screen.getByText("(120)")).toBeTruthy();
  });
});

describe("LinkCard", () => {
  test("links to href in a new tab and shows the domain", () => {
    render(<LinkCard href="https://www.example.com/a" title="Example" />);
    const link = screen.getByRole("link", { name: /Example/ });
    expect(link.getAttribute("href")).toBe("https://www.example.com/a");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("example.com")).toBeTruthy();
  });

  test("a bound onClick makes it a button", () => {
    const onClick = vi.fn(ok);
    render(
      <LinkCard href="https://example.com" title="Example" onClick={onClick} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Example/ }));
    expect(onClick).toHaveBeenCalledWith({});
  });
});

describe("Citation", () => {
  test("shows the index and reveals the source on click", () => {
    render(
      <Citation
        index={2}
        title="The source"
        url="https://example.com/post"
        snippet="A quoted line"
      />,
    );
    const marker = screen.getByRole("button", { name: /2/ });
    fireEvent.click(marker);
    expect(screen.getByText("The source")).toBeTruthy();
    expect(screen.getByText("A quoted line")).toBeTruthy();
  });
});

describe("ImageGrid", () => {
  const images = [
    { url: "https://example.com/1.jpg", description: "One" },
    { url: "https://example.com/2.jpg", description: "Two" },
    { url: "https://example.com/3.jpg", description: "Three" },
  ];

  test("renders a Kumo grid with one image per item", () => {
    const { container } = render(<ImageGrid images={images} columns={3} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  test("bento makes the first image twice as large", () => {
    const { container } = render(
      <ImageGrid images={images} columns={3} layout="bento" />,
    );
    const first = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(first.style.gridColumn).toBe("span 2");
    expect(first.style.gridRow).toBe("span 2");
  });

  test("renders with no images", () => {
    const { container } = render(<ImageGrid />);
    expect(container).toBeTruthy();
  });
});
