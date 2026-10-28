import { z } from "zod";
import { FRONTENDS, FRAMEWORKS, type FrontendId } from "@/proto/data";
import { LIVE_FRAMEWORKS } from "./live-scope";
import { getCapabilityLink, getSetupLinks } from "./home-docs-links";

/** Small, reviewed set of destinations; the model selects IDs, never URLs. */
export const DOCS_CHAT_GUIDES = {
  quickstart: {
    title: "Connect your agent",
    description: "Set up CopilotKit for your frontend and agent framework.",
    path: "/quickstart",
    scoped: true,
  },
  "agent-setup": {
    title: "Set up your agent backend",
    description:
      "Backend setup in the React quickstart; pair it with your frontend guide.",
    path: "/quickstart",
    scoped: true,
  },
  chat: {
    title: "Add a chat interface",
    description: "Build a chat UI for conversations with your agent.",
    path: "/agentic-chat-ui",
    scoped: true,
  },
  "frontend-tools": {
    title: "Let your agent use your app",
    description: "Expose application actions as tools your agent can call.",
    path: "/frontend-tools",
    scoped: true,
  },
  "generative-ui": {
    title: "Render UI from agent tools",
    description: "Show components alongside your agent’s responses.",
    path: "/generative-ui",
    scoped: true,
  },
  "shared-state": {
    title: "Share state with your agent",
    description: "Keep agent state and your application UI in sync.",
    path: "/shared-state",
    scoped: true,
  },
  "human-in-the-loop": {
    title: "Ask for user input",
    description: "Pause an agent action for a decision or approval.",
    path: "/human-in-the-loop",
    scoped: true,
  },
  threads: {
    title: "Manage conversations",
    description: "Create, switch, and resume conversation threads.",
    path: "/threads-lifecycle",
    scoped: true,
  },
  streams: {
    title: "Keep runs connected",
    description: "Read about reconnecting and catching up with AG-UI Streams.",
    path: "/AG-UI-Streams",
    scoped: false,
  },
  learning: {
    title: "Improve agents from feedback",
    description: "Explore the review and publish workflow for learning.",
    path: "/learning",
    scoped: false,
  },
} as const;

export type DocsGuideId = keyof typeof DOCS_CHAT_GUIDES;
export const guideIdSchema = z.enum(
  Object.keys(DOCS_CHAT_GUIDES) as [DocsGuideId, ...DocsGuideId[]],
);
export const frontendSchema = z.enum(
  FRONTENDS.map((item) => item.id) as [FrontendId, ...FrontendId[]],
);
export const frameworkSchema = z.enum(
  Object.keys(LIVE_FRAMEWORKS) as [string, ...string[]],
);
export const guideRequestSchema = z.object({
  guides: z.array(guideIdSchema).min(1).max(3),
  frontend: frontendSchema.default("react"),
  framework: frameworkSchema.default("built-in-agent"),
});
export type GuideRequest = z.infer<typeof guideRequestSchema>;
type GuideLink = {
  id: DocsGuideId;
  title: string;
  description: string;
  url: string;
};

/** Chat and homepage navigation use the same frontend-specific destinations. */
export function resolveDocsGuideRequest(request: GuideRequest) {
  const links = request.guides.flatMap<GuideLink>((id) => {
    if (id === "quickstart")
      return getSetupLinks(request).map((link, index) => ({
        ...link,
        id: index === 0 ? ("quickstart" as const) : ("agent-setup" as const),
      }));
    if (id === "agent-setup")
      return [
        {
          ...getSetupLinks({ ...request, frontend: "react" })[0],
          id,
          title: "Set up your agent backend",
          description: DOCS_CHAT_GUIDES[id].description,
        },
      ];
    if (id === "streams" || id === "learning") {
      const guide = DOCS_CHAT_GUIDES[id];
      return [
        {
          id,
          title: guide.title,
          description: guide.description,
          url: guide.path,
        },
      ];
    }
    return [{ ...getCapabilityLink(id, request), id }];
  });
  return links
    .filter(
      (link, index) =>
        links.findIndex((other) => other.url === link.url) === index,
    )
    .slice(0, 3);
}

export const STACK_CHOICES = {
  frontend: FRONTENDS.map(({ id, name }) => ({ id, name })),
  framework: Object.keys(LIVE_FRAMEWORKS).map((id) => ({
    id,
    name: FRAMEWORKS.find((item) => item.id === id)?.name ?? id,
  })),
};
