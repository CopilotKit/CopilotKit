import {
  MessageSquare,
  Layers,
  Code,
  Bot,
  Server,
  BookOpen,
} from "lucide-react";
import Link from "next/link";

export const FeatureGrid = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-8 mt-6 mb-16 not-prose">
    <Link
      href="/agentic-chat-ui"
      className="group flex items-start gap-4 no-underline"
    >
      <div className="shrink-0 mt-1">
        <MessageSquare className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
          Chat UI &rsaquo;
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
          Prebuilt chat components with streaming, tool calls, and markdown.
        </div>
      </div>
    </Link>
    <Link
      href="/headless"
      className="group flex items-start gap-4 no-underline"
    >
      <div className="shrink-0 mt-1">
        <Code className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
          Headless UI &rsaquo;
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
          Full rendering control via hooks — zero opinions on design.
        </div>
      </div>
    </Link>
    <Link
      href="/generative-ui"
      className="group flex items-start gap-4 no-underline"
    >
      <div className="shrink-0 mt-1">
        <Layers className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
          Generative UI &rsaquo;
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
          Render agent tools and state as interactive React components.
        </div>
      </div>
    </Link>
    <Link href="/backend" className="group flex items-start gap-4 no-underline">
      <div className="shrink-0 mt-1">
        <Server className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
          Backend &amp; Runtime &rsaquo;
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
          Set up the CopilotKit runtime, AG-UI middleware, and endpoints.
        </div>
      </div>
    </Link>
    <Link
      href="/coding-agent-setup"
      className="group flex items-start gap-4 no-underline"
    >
      <div className="shrink-0 mt-1">
        <Bot className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
          Programmatic Control &rsaquo;
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
          Build non-chat or fully custom experiences.
        </div>
      </div>
    </Link>
    <Link
      href="/reference"
      className="group flex items-start gap-4 no-underline"
    >
      <div className="shrink-0 mt-1">
        <BookOpen className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
          API Reference &rsaquo;
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
          Complete reference for hooks, components, and configuration.
        </div>
      </div>
    </Link>
  </div>
);
