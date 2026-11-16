import type { VariantId } from "./routes";

export interface VariantMeta {
  id: VariantId;
  name: string;
  from: string;
  summary: string;
  ideas: string[];
  entry: string;
}

export const VARIANTS: VariantMeta[] = [
  {
    id: "a",
    name: "Framework in the URL, frontend in the page",
    from: "Sentry + Storybook + Prisma",
    summary:
      "The framework lives in the sidebar and the URL, the frontend is a row of buttons under the title, and one sentence names both.",
    ideas: [
      "Sentry: framework menu tops the sidebar; titles name the framework; links without one ask you to pick",
      "Storybook: frontend buttons under every title, remembered across pages",
      "Prisma: \u201cThis page uses React and Mastra. Use Vue instead\u201d",
    ],
    entry: "/proto/a/mastra/human-in-the-loop",
  },
  {
    id: "b",
    name: "Every framework gets a home",
    from: "Vercel AI SDK + Clerk + Expo",
    summary:
      "A directory gives every framework a home page, each page shows which frameworks it covers, and the quickstart asks two questions once.",
    ideas: [
      "AI SDK: the docs home is a directory of framework cards with their features; each has its own page",
      "Clerk: \u201cSelect your agent framework\u201d in the sidebar, \u201cAvailable for\u201d tiles beside every page",
      "Expo: the quickstart asks what you build with and which agent framework",
    ],
    entry: "/proto/b/docs",
  },
  {
    id: "c",
    name: "Sections on top",
    from: "AWS Amplify + LangChain + Supabase",
    summary:
      "Docs, Integrations, and Intelligence are top-level sections, and each framework gets its own quickstart page.",
    ideas: [
      "Amplify and LangChain: a section menu for Docs, Integrations, Intelligence; \u201cChoose your frontend\u201d in the sidebar",
      "Supabase: an Agent quickstarts list in the sidebar and as cards, one page per framework",
    ],
    entry: "/proto/c/docs",
  },
  {
    id: "d",
    name: "Home first, then the docs",
    from: "Fumadocs home layout",
    summary:
      "A navbar-only home page of link cards; opening a card switches to the docs layout, with your stack as the sidebar picker.",
    ideas: [
      "Fumadocs Home Layout: a navbar with Docs and Integrations menus, search, and no sidebar",
      "The home page is link cards: topics, Intelligence, and every agent framework",
      "Open a card: the docs layout takes over, and the sidebar picker sets frontend and framework",
    ],
    entry: "/",
  },
];

export function variantMeta(id: VariantId) {
  return VARIANTS.find((v) => v.id === id)!;
}
