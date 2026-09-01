export const INTELLIGENCE_DOCS_HREF = "/intelligence/overview";

export type MegaMenuIconName =
  | "book"
  | "rocket"
  | "terminal"
  | "message"
  | "sparkles"
  | "bot"
  | "layers"
  | "refresh"
  | "link"
  | "blocks"
  | "search"
  | "cloud"
  | "server"
  | "atom"
  | "box"
  | "radio"
  | "brain"
  | "chart";

export interface MegaMenuLink {
  href: string;
  label: string;
  icon: MegaMenuIconName;
  description?: string;
  featured?: boolean;
}

export interface MegaMenuColumn {
  title: string;
  links: readonly MegaMenuLink[];
}

export const DOCS_MEGA_MENU_COLUMNS: readonly MegaMenuColumn[] = [
  {
    title: "Start",
    links: [
      { href: "/", label: "Introduction", icon: "book" },
      { href: "/quickstart", label: "Quickstart", icon: "rocket" },
      { href: "/cli", label: "CLI", icon: "terminal" },
    ],
  },
  {
    title: "Build",
    links: [
      { href: "/prebuilt-components", label: "Chat UI", icon: "message" },
      {
        href: "/generative-ui",
        label: "Generative UI",
        icon: "sparkles",
      },
      { href: "/frontend-tools", label: "Agent behavior", icon: "bot" },
      { href: "/threads", label: "Rich Threads", icon: "layers" },
    ],
  },
  {
    title: "Connect",
    links: [
      { href: "/backend/copilot-runtime", label: "Runtime", icon: "refresh" },
      { href: "/agentic-protocols/ag-ui", label: "AG-UI", icon: "link" },
      { href: "/build-with-agents", label: "Integrations", icon: "blocks" },
    ],
  },
  {
    title: "Ship & Operate",
    links: [
      {
        href: INTELLIGENCE_DOCS_HREF,
        label: "Intelligence",
        icon: "sparkles",
        description: "Threads, learning, and analytics",
        featured: true,
      },
      { href: "/threads", label: "Threads", icon: "layers" },
      {
        href: "/backend/copilot-runtime",
        label: "Learning",
        icon: "brain",
      },
      {
        href: "/intelligence/managed-intelligence-platform",
        label: "Analytics",
        icon: "chart",
      },
      { href: "/inspector", label: "Inspector", icon: "search" },
      { href: "/deploy/agentcore", label: "Deploy", icon: "cloud" },
      {
        href: "/intelligence/self-hosting",
        label: "Self-hosting",
        icon: "server",
      },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/reference", label: "React API", icon: "atom" },
      { href: "/reference/core", label: "Runtime API", icon: "box" },
      { href: "/reference/channels", label: "Channels API", icon: "radio" },
    ],
  },
];

export function isIntelligenceDocsPath(pathname: string) {
  const path = pathname.split("?")[0] ?? pathname;
  return /(^|\/)(intelligence|premium)(\/|$)/.test(path);
}

export function isDocsExplorePath(pathname: string) {
  const firstSegment = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;
  return (
    firstSegment !== "/reference" &&
    firstSegment !== "/cookbook" &&
    firstSegment !== "/intelligence"
  );
}
