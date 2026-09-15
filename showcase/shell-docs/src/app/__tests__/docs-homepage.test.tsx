import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { visibleIntegrations } from "@/lib/homepage-map";
import { ROOT_FRAMEWORK } from "@/lib/registry";

// The homepage route composes the hero, a video placeholder, the setup
// wizard's intro + widget, and the backend logo grid. Mounting the whole
// route with `render()` would pull in the fumadocs shell `ShellDocsLayout`
// wraps (no test anywhere in this app mounts that) and the registry-backed
// wizard (~646 KB per `docs-setup-wizard.tsx`'s own header comment) — neither
// of which this file is responsible for verifying. So these assertions call
// the route function directly and read the plain React element tree it
// returns, the same technique `cookbook-onboarding.test.tsx` uses for the
// same reason. The setup wizard, the video carousel and the backend grid are
// all mocked out here, both because each one's own render is someone else's
// test's job (docs-setup-wizard.test.tsx, docs-video-carousel.test.tsx,
// docs-landing-next.test.tsx) and to keep this file's job to composition and
// ordering only.
const docsSetupWizardSpy = vi.hoisted(() => vi.fn(() => null));
const docsVideoCarouselSpy = vi.hoisted(() => vi.fn(() => null));
const docsLandingNextSpy = vi.hoisted(() => vi.fn(() => null));

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

// Restored from `origin/main` — see docs-landing-next.test.tsx for its own
// render. Here we only need to know the homepage route renders it, and
// renders it after the wizard.
vi.mock("@/components/docs-landing-next", () => ({
  DocsLandingNext: docsLandingNextSpy,
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
  it("explains the product and restores the canonical copy-prompt action", async () => {
    const elements = await renderOverview();
    const heading = elements.find((el) => el.type === "h1");
    expect(heading && textOf(heading)).toBe("Bring your agentinto any app.");
    expect(
      elements.some(
        (el) => el.type === "p" && textOf(el).includes("open-source framework"),
      ),
    ).toBe(true);
    const cta = elements.find(
      (el) =>
        typeof el.type === "function" &&
        el.type.name === "HeroOnboardingPromptButton",
    );
    expect(cta?.props.surface).toBe("docs_landing_hero");
    expect(
      elements.some((el) => el.type === "section" && el.props.id === "setup"),
    ).toBe(true);
  });

  it("offers every visible quickstart with the default first", async () => {
    const elements = await renderOverview();
    const dropdown = elements.find(
      (el) =>
        typeof el.type === "function" &&
        el.type.name === "HeroQuickstartDropdown",
    );
    const options = dropdown!.props.options as Array<{
      slug: string;
      href: string;
    }>;
    expect(options).toHaveLength(visibleIntegrations().length);
    expect(options[0]).toMatchObject({
      slug: ROOT_FRAMEWORK,
      href: "/quickstart",
    });
    for (const option of options.slice(1)) {
      expect(option.href).toBe(`/${option.slug}/quickstart`);
    }
  });

  it("keeps the product demo, guided setup, and integrations in that order", async () => {
    const elements = await renderOverview();
    const content = elements.filter((el) =>
      [docsVideoCarouselSpy, docsSetupWizardSpy, docsLandingNextSpy].includes(
        el.type as typeof docsVideoCarouselSpy,
      ),
    );
    expect(content.map((el) => el.type)).toEqual([
      docsVideoCarouselSpy,
      docsSetupWizardSpy,
      docsLandingNextSpy,
    ]);
  });

  it("explains that setup supports existing apps and produces a coding-agent prompt", async () => {
    const elements = await renderOverview();
    const section = elements.find(
      (el) => el.type === "section" && el.props.id === "setup",
    )!;
    const text = textOf(section);
    expect(text).toContain("Start fresh or add to your existing app");
    expect(text).toContain("setup prompt to your coding agent");
  });
});
