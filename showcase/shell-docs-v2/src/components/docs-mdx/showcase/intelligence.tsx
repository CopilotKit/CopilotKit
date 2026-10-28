// <IntelligenceOverview /> and <IntelligenceFeatureCards />: the
// Intelligence overview's hero (product video and quickstart) and its
// capability cards. A port of shell-docs'
// content/landing-pages/intelligence-overview.tsx and lib/intelligence-features.ts.

import type { ComponentType, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { PiChartBarFill, PiHashFill, PiMagnifyingGlassFill } from "react-icons/pi";
import {
  Card as FumadocsCard,
  Cards as FumadocsCards,
} from "fumadocs-ui/components/card";
import {
  InteractivityGlyph,
  LearningGlyph,
  MemoryGlyph,
  ThreadsGlyph,
} from "@/components/icons/glyphs";
import type { DocsMdxContext } from "../context";
import { docsHref } from "../href";
import type { DocsScope } from "../scope";
import { ProductVideo, TrackedLink } from "./client";
import { PRIMARY_PILL } from "./styles";

const SIZZLE_VIDEO_URL =
  "https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3";

/** shell-docs' INTELLIGENCE_FEATURES, the copy shared with its llms.txt. */
const INTELLIGENCE_FEATURES = [
  {
    title: "AG-UI Streams",
    body: "Complement your existing threads with generative UI, multimodal inputs and file uploads, plus reconnection and catch-up across tabs and devices.",
    href: "/AG-UI-Streams",
    Icon: ThreadsGlyph,
  },
  {
    title: "User Memories",
    body: "Keep facts about a person after the conversation ends.",
    href: "/intelligence/memories",
    Icon: MemoryGlyph,
  },
  {
    title: "Automatic Learning",
    body: "Turn real usage into skills you can review and publish.",
    href: "/learning",
    Icon: LearningGlyph,
  },
  {
    title: "Trajectories",
    body: "Capture browser activity and connect it to agent conversations.",
    href: "/intelligence/trajectories",
    Icon: InteractivityGlyph,
  },
  {
    title: "Product Analytics",
    body: "See what people do with your agent.",
    href: "/intelligence/analytics",
    Icon: PiChartBarFill,
  },
  {
    title: "Channels",
    body: "Run the same agent in Slack or Microsoft Teams.",
    href: "/intelligence/channels",
    Icon: PiHashFill,
  },
  {
    title: "Inspector",
    body: "Watch threads, learning, and tool calls from your app on localhost.",
    href: "/inspector",
    Icon: PiMagnifyingGlassFill,
  },
];

const QUICKSTART_HREF = "/intelligence/quickstart";
const OVERVIEW_PATH = "/intelligence/overview";

export function IntelligenceOverview({ scope }: { scope: DocsScope }) {
  const href = docsHref(QUICKSTART_HREF, scope);
  return (
    <div className="not-prose my-6 flex flex-col gap-5">
      <div className="overflow-hidden rounded-xl border bg-card">
        <ProductVideo
          src={SIZZLE_VIDEO_URL}
          label="CopilotKit Intelligence product demo"
        />
      </div>
      <div>
        <TrackedLink
          href={href}
          event="docs.journey_continued"
          properties={{
            destination_type: "quickstart",
            destination_path: href,
            from_path: OVERVIEW_PATH,
          }}
          className={PRIMARY_PILL}
        >
          Quickstart
          <ArrowRight className="size-4" aria-hidden="true" />
        </TrackedLink>
      </div>
    </div>
  );
}

type CardsComponent = ComponentType<{ children?: ReactNode }>;
type CardComponent = ComponentType<{
  href?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}>;

export function IntelligenceFeatureCards({
  scope,
  ctx,
}: {
  scope: DocsScope;
  ctx: DocsMdxContext;
}) {
  const components = ctx.components() as Record<string, unknown>;
  const Cards = (components.Cards ?? FumadocsCards) as CardsComponent;
  const Card = (components.Card ?? FumadocsCard) as CardComponent;
  const H2 = (components.h2 ?? "h2") as ComponentType<{
    id: string;
    children: ReactNode;
  }>;
  return (
    <section aria-labelledby="intelligence-features">
      <H2 id="intelligence-features">What Intelligence gives you</H2>
      <p>
        Each capability is a page of its own, and every one works with the agent
        and frontend you already run. Open the one you want to add first.
      </p>
      <Cards>
        {INTELLIGENCE_FEATURES.map(({ title, body, href, Icon }) => (
          <Card
            key={title}
            href={docsHref(href, scope)}
            title={title}
            description={body}
            icon={<Icon aria-hidden="true" />}
          />
        ))}
      </Cards>
    </section>
  );
}
