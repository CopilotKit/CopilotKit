import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { describe, expect, it, vi } from "vitest";
import { MapIntro } from "@/components/docs-map-parts";
import { visibleIntegrations } from "@/lib/homepage-map";
import { ROOT_FRAMEWORK } from "@/lib/registry";

// The homepage route composes the hero, a video placeholder, and the setup
// wizard's intro + widget. Mounting the whole route with `render()` would
// pull in the fumadocs shell `ShellDocsLayout` wraps (no test anywhere in
// this app mounts that) and the registry-backed wizard (~646 KB per
// `docs-setup-wizard.tsx`'s own header comment) — neither of which this file
// is responsible for verifying. So these assertions call the route function
// directly and read the plain React element tree it returns, the same
// technique `cookbook-onboarding.test.tsx` uses for the same reason. The
// setup wizard itself is mocked out, both because its own render is someone
// else's test's job and because it currently pulls in a sibling component
// that another task is still writing.
const docsSetupWizardSpy = vi.hoisted(() => vi.fn(() => null));
const docsVideoCarouselSpy = vi.hoisted(() => vi.fn(() => null));

vi.mock("@/components/docs-setup-wizard", () => ({
  DocsSetupWizard: docsSetupWizardSpy,
}));

// Mounting the real carousel (three iframes' worth of tab/panel markup) is
// someone else's test's job — see docs-video-carousel.test.tsx. Here we only
// need to know the homepage route renders it in place of the old
// placeholder.
vi.mock("@/components/docs-video-carousel", () => ({
  DocsVideoCarousel: docsVideoCarouselSpy,
}));

import DocsPage from "../[[...slug]]/page";

type AnyElement = ReactElement<Record<string, unknown>>;

function isElement(node: unknown): node is AnyElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node
  );
}

// Depth-first, in the order JSX children are written — i.e. document order.
function collect(node: ReactNode, acc: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, acc);
    return acc;
  }
  if (isElement(node)) {
    acc.push(node);
    collect(node.props.children as ReactNode, acc);
  }
  return acc;
}

function textOf(element: AnyElement): string {
  const { children } = element.props;
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children
      .map((child) =>
        typeof child === "string"
          ? child
          : isElement(child)
            ? textOf(child)
            : "",
      )
      .join("");
  }
  if (isElement(children)) return textOf(children);
  return "";
}

async function renderOverview(): Promise<AnyElement[]> {
  const routeElement = (await DocsPage({
    params: Promise.resolve({}),
  })) as AnyElement;
  // The route returns `<DocsOverview />` unrendered — calling its `type`
  // directly runs the function and gives the tree it returns, without
  // mounting the fumadocs shell it's wrapped in.
  const overview = (routeElement.type as () => ReactElement)();
  return collect(overview);
}

describe("the docs homepage route", () => {
  it("renders the hero heading, positioning line and Intelligence link", async () => {
    const elements = await renderOverview();

    const heading = elements.find((el) => el.type === "h1");
    expect(heading && textOf(heading)).toBe("CopilotKit");

    const positioning = elements.find(
      (el) =>
        el.type === "p" && textOf(el).startsWith("Give your app an agent"),
    );
    expect(positioning && textOf(positioning)).toBe(
      "Give your app an agent your users can actually use.",
    );

    const intelligenceLink = elements.find((el) => el.type === Link);
    expect(intelligenceLink).toBeTruthy();
    expect(intelligenceLink?.props.href).toBe("/intelligence/overview");
    expect(intelligenceLink && textOf(intelligenceLink)).toBe(
      "CopilotKit Intelligence",
    );
  });

  // The hero carries both actions and the three starting points, matching
  // the header the product-map draft used.
  //
  // The two buttons reach `HeroStartActions` as element-valued *props*
  // (`prompt`, `quickstart`), not as children, so the element walk below
  // never descends into them — read them off the props instead. Asserting
  // the labels as well as the components matters: the components alone
  // would still pass with an empty option list, and the labels alone would
  // pass if the buttons were dropped but the list kept.
  it("renders the copy-prompt button, the quickstart dropdown and the three starting points", async () => {
    const elements = await renderOverview();

    const startActions = elements.find(
      (el) =>
        typeof el.type === "function" && el.type.name === "HeroStartActions",
    );
    expect(startActions).toBeTruthy();

    const nameOf = (node: unknown): string => {
      const el = node as AnyElement | undefined;
      return el && typeof el.type === "function" ? el.type.name : "";
    };
    expect(nameOf(startActions!.props.prompt)).toBe(
      "HeroOnboardingPromptButton",
    );
    expect(nameOf(startActions!.props.quickstart)).toBe(
      "HeroQuickstartDropdown",
    );

    const allText = elements.map((el) => textOf(el)).join(" | ");
    expect(allText).toContain("New project");
    expect(allText).toContain("Existing app or agent");
    expect(allText).toContain("Already on CopilotKit");
  });

  // The dropdown is useless without options, and they come from the
  // registry rather than a literal — a count would go stale the moment a
  // partner integration ships. Derive the expectation instead, and pin the
  // default framework to the front, since its quickstart is the one served
  // at the unprefixed root.
  it("feeds the quickstart dropdown every visible integration, default first", async () => {
    const elements = await renderOverview();

    const startActions = elements.find(
      (el) =>
        typeof el.type === "function" && el.type.name === "HeroStartActions",
    );
    const dropdown = startActions!.props.quickstart as AnyElement;
    const options = dropdown.props.options as Array<{
      slug: string;
      href: string;
    }>;

    expect(options).toHaveLength(visibleIntegrations().length);
    expect(options[0]!.slug).toBe(ROOT_FRAMEWORK);
    expect(options[0]!.href).toBe("/quickstart");
    expect(options[1]!.href).toBe(`/${options[1]!.slug}/quickstart`);
  });

  // The route used to render a dashed placeholder box whose text was
  // "Product walkthrough video coming soon" (see git history on
  // page.tsx) — a real string this test could fail against, not a guard
  // against wording that was never there. The video carousel replaces it.
  it("no longer renders the video placeholder wording", async () => {
    const elements = await renderOverview();

    const allText = elements.map((el) => textOf(el)).join(" | ");
    expect(allText.toLowerCase()).not.toContain("coming soon");
  });

  it("renders the video carousel", async () => {
    const elements = await renderOverview();

    expect(elements.some((el) => el.type === docsVideoCarouselSpy)).toBe(true);
  });

  it("renders the wizard intro heading and body", async () => {
    const elements = await renderOverview();

    const intro = elements.find((el) => el.type === MapIntro);
    expect(intro).toBeTruthy();
    const { heading, body } = intro!.props as { heading: string; body: string };
    expect(typeof heading).toBe("string");
    expect(heading.length).toBeGreaterThan(0);
    expect(typeof body).toBe("string");
    expect(body.length).toBeGreaterThan(0);
  });

  it("renders the setup wizard", async () => {
    const elements = await renderOverview();

    expect(elements.some((el) => el.type === docsSetupWizardSpy)).toBe(true);
  });

  // Exact ordered equality over the headings' own texts — not `indexOf`
  // on a substring, which is how this test previously passed for the wrong
  // reason (an `indexOf("Frontend")` match inside "Frontend tools" text
  // that had nothing to do with ordering).
  it("keeps the hero heading before the wizard intro heading, in document order", async () => {
    const elements = await renderOverview();

    const headingTexts = elements
      .filter((el) => el.type === "h1" || el.type === MapIntro)
      .map((el) =>
        el.type === "h1" ? textOf(el) : (el.props.heading as string),
      );

    expect(headingTexts).toEqual([
      "CopilotKit",
      "Set up CopilotKit for your project",
    ]);
  });
});
