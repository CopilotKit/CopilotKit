import { renderToStaticMarkup } from "react-dom/server";
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
    expect(markup).toContain("CopilotKit");
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
    navigation.pathname = "/frontends/vue";

    const markup = renderToStaticMarkup(
      <FrameworkSelector
        options={options}
        categoryOrder={[]}
        variant="sidebar"
      />,
    );

    expect(markup).toContain("Frontend");
    expect(markup).toContain("Vue");
    expect(markup).not.toContain("React Native");
  });
});
