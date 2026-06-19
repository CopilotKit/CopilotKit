import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("../framework-provider", () => ({
  useFramework: () => ({
    framework: null,
    effectiveFramework: "built-in-agent",
    setStoredFramework: vi.fn(),
  }),
}));

import { FrameworkSelector } from "../framework-selector";

const options = [
  {
    slug: "built-in-agent",
    name: "CopilotKit's Built-in Agent",
    category: "core",
    logo: "/logos/built-in-agent.svg",
    deployed: true,
  },
  {
    slug: "langgraph-python",
    name: "LangChain",
    category: "agent-frameworks",
    logo: "/logos/langgraph.svg",
    deployed: true,
  },
  {
    slug: "crewai-crews",
    name: "CrewAI",
    category: "agent-frameworks",
    logo: "/logos/crewai.svg",
    deployed: true,
  },
  {
    slug: "mastra",
    name: "Mastra",
    category: "agent-frameworks",
    logo: "/logos/mastra.svg",
    deployed: true,
  },
  {
    slug: "pydantic-ai",
    name: "PydanticAI",
    category: "agent-frameworks",
    logo: "/logos/pydantic-ai.svg",
    deployed: true,
  },
];

describe("FrameworkSelector", () => {
  it("renders separate sidebar selectors for frontend and backend", () => {
    navigation.pathname = "/";
    const markup = renderToStaticMarkup(
      <FrameworkSelector
        options={options}
        categoryOrder={[]}
        variant="sidebar"
      />,
    );
    const frontendIndex = markup.indexOf("Frontend");
    const backendIndex = markup.indexOf("Agent backend");

    expect(frontendIndex).toBeGreaterThanOrEqual(0);
    expect(backendIndex).toBeGreaterThanOrEqual(0);
    expect(frontendIndex).toBeLessThan(backendIndex);
    expect(markup).toContain("React");
    expect(markup).not.toContain("Early access");
    expect(markup).toContain("CopilotKit");
    expect(
      markup.match(
        /shell-docs-picker-group shell-docs-picker-group-selected shell-docs-picker-group-bordered/g,
      )?.length,
    ).toBe(1);
    expect(markup).not.toContain("shell-docs-picker-row-selected");
    expect(markup).not.toContain("shell-docs-nav-link-active");
    expect(markup.match(/shell-docs-picker-row-divided/g)?.length).toBe(1);
    expect(markup.match(/<button/g)?.length).toBe(2);
    expect(markup).not.toContain("Choose your stack");
    expect(markup).not.toContain("Current stack");
    expect(markup).not.toContain("Current backend");
    expect(markup).not.toContain("Current");
    expect(markup).not.toContain("Choose any agent backend");
    expect(markup).not.toContain("Change");
    expect(markup).not.toContain("Other available agent backends");
    expect(markup).not.toContain("+1");
    expect(markup).not.toContain("Agent backends");
    expect(markup).not.toContain("Choose your agent backend");
    expect(markup).not.toContain("Any agent backend");
    expect(markup).not.toContain("Agentic backend");
  });

  it("reflects the frontend selected by the URL", () => {
    navigation.pathname = "/vue";

    const markup = renderToStaticMarkup(
      <FrameworkSelector
        options={options}
        categoryOrder={[]}
        variant="sidebar"
      />,
    );

    expect(markup).toContain("Frontend");
    expect(markup).toContain("Vue");
    expect(markup).not.toContain("Early access");
    expect(markup).not.toContain("px-1 py-0 text-[8px]");
    expect(markup).not.toContain("leading-[10px]");
    expect(markup).toContain("mt-0.5 flex min-w-0 items-center gap-2");
    expect(markup).not.toContain("React Native");
  });

  it("keeps the early access badge for Slack and Teams only", () => {
    navigation.pathname = "/slack";

    const markup = renderToStaticMarkup(
      <FrameworkSelector
        options={options}
        categoryOrder={[]}
        variant="sidebar"
      />,
    );

    expect(markup).toContain("Slack");
    expect(markup).toContain("Early access");
    expect(markup).toContain("px-1 py-0 text-[8px]");
    expect(markup).toContain("leading-[10px]");
    expect(markup).toContain("self-center");
  });

  it("uses a picker menu shadow that does not bleed upward", () => {
    const componentSource = readFileSync(
      new URL("../framework-selector.tsx", import.meta.url),
      "utf8",
    );
    const cssSource = readFileSync(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(componentSource).toContain("shell-docs-picker-menu");
    expect(componentSource).not.toContain("shadow-[var(--shadow-panel)]");
    expect(cssSource).toContain(".shell-docs-picker-menu");
    expect(cssSource).toContain("clip-path: inset(0 -48px -48px -48px)");
  });

  it("keeps the picker fill subtler than active navigation", () => {
    const cssSource = readFileSync(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(cssSource).toContain(`.shell-docs-picker-group-selected {
  background: color-mix(in oklch, var(--accent-dim) 34%, transparent);
}`);
    expect(cssSource).not.toContain(`.shell-docs-picker-group-selected {
  background: color-mix(in oklch, var(--accent) 13%, transparent);
}`);
  });

  it("routes backend selections even from frontend docs routes", () => {
    const componentSource = readFileSync(
      new URL("../framework-selector.tsx", import.meta.url),
      "utf8",
    );

    expect(componentSource).not.toContain("if (!urlFrontend)");
    expect(componentSource).toContain(
      "router.replace(\n      backendPathForCurrentPath(",
    );
  });
});
