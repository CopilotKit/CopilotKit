"use client";

import {
  ArrowRight,
  BarChart3,
  Brain,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { IntelligenceKiteIcon } from "@/components/intelligence-kite-icon";

const CAPABILITIES = [
  {
    icon: MessagesSquare,
    title: "Rich Threads",
    body: "Restore conversations, UI, and tool activity across sessions.",
    href: "/threads",
  },
  {
    icon: Brain,
    title: "User Memories",
    body: "Remember what matters across conversations.",
    href: "/intelligence/memories",
  },
  {
    icon: Sparkles,
    title: "Automatic Learning",
    body: "Turn completed conversations into skills you review.",
    href: "/learning",
  },
  {
    icon: BarChart3,
    title: "Product Analytics",
    body: "Understand how people use your agents.",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights",
  },
];

export interface IntelligenceUpgradeSectionProps {
  frameworkName: string;
  frameworkSlug: string;
  link: (href: string) => string;
}

export function IntelligenceUpgradeSection({
  link,
}: IntelligenceUpgradeSectionProps) {
  return (
    <section
      className="partner-section partner-intelligence"
      aria-labelledby="partner-intelligence-title"
    >
      <div className="partner-section-heading">
        <h2 id="partner-intelligence-title">
          <IntelligenceKiteIcon aria-hidden="true" />
          CopilotKit Intelligence
        </h2>
      </div>
      <p className="partner-section-intro">
        Add replayable conversations, memory, and learning alongside your
        agent’s existing persistence.
      </p>
      <div className="partner-intelligence-grid">
        {CAPABILITIES.map(({ icon: Icon, title, body, href }) => (
          <Link
            key={title}
            href={link(href)}
            className="partner-card partner-intelligence-card"
          >
            <div className="partner-card-top">
              <Icon size={18} aria-hidden="true" />
              <h3>{title}</h3>
              <ArrowRight
                size={15}
                className="partner-card-arrow"
                aria-hidden="true"
              />
            </div>
            <p>{body}</p>
          </Link>
        ))}
      </div>
      <Link
        className="partner-more partner-text-link"
        href={link("/intelligence/overview")}
      >
        Explore Intelligence <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}
