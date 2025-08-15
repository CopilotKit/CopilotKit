"use client"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/react/frame";
import { LuBookOpen, LuBanknote, LuPlane, LuFileSpreadsheet, LuCode, LuExternalLink, LuLightbulb } from "react-icons/lu";
import { badgeVariants } from "@/components/ui/badge";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Tabs, Tab } from "@/components/react/tabs";
import { YouTubeVideo } from "./youtube-video";

interface CarouselExample {
  icon: React.ElementType;
  title: string;
  description: string;
  media: {
    type: 'video' | 'image' | 'youtube';
    src: string;
  };
  links: {
    source?: string;
    demo?: string;
    tutorial?: string;
  };
}

interface ExamplesCarouselProps {
  id: string
  examples?: CarouselExample[];
}

const badgeStyles = cn(badgeVariants({ variant: "outline" }), "bg-indigo-500 hover:bg-indigo-600 text-white no-underline focus:ring-1 focus:ring-indigo-500");

export function ExamplesCarousel({ id, examples = LandingExamples }: ExamplesCarouselProps) {
  return (
    <Tabs groupId={id} items={
      examples.map((example) => {
        const Icon = example.icon;
        return {
          value: example.title,
          icon: <Icon className="w-4 h-4" />
        }
      })
    }>
      {examples.map((example, index) => {
        const Icon = example.icon;
        return (
          <Tab key={index} value={example.title}>
            <Card className="border-none shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center text-xl">
                  <Icon className="mr-2" />
                  {example.title}
                </CardTitle>
                <div className="flex flex-wrap gap-2 my-2 pt-2">
                  {example.links.source && (
                    <Link 
                      href={example.links.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={badgeStyles}
                    >
                      <LuCode className="mr-2 h-3.5 w-3.5" />
                      Source
                    </Link>
                  )}
                  {example.links.demo && (
                    <Link 
                      href={example.links.demo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={badgeStyles}
                    >
                      <LuExternalLink className="mr-2 h-3.5 w-3.5" />
                      Demo
                    </Link>
                  )}
                  {example.links.tutorial && (
                    <Link 
                      href={example.links.tutorial}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={badgeStyles}
                    >
                      <LuBookOpen className="mr-2 h-3.5 w-3.5" />
                      Tutorial
                    </Link>
                  )}
                </div>
                <CardDescription className="text-base pt-6 text-primary">
                  {example.description}
                </CardDescription>
                <div className="w-full">
                  {example.media.type === 'video' && (
                    <video 
                      autoPlay 
                      loop 
                      muted 
                      controls 
                      playsInline
                      src={example.media.src}
                      className="rounded-2xl shadow-xl border w-full h-auto"
                    />
                  )}
                  {example.media.type === 'image' && (
                    <Frame className="rounded-2xl shadow-xl">
                      <img src={example.media.src} className="w-full h-auto" alt="" />
                    </Frame>
                  )}
                  {example.media.type === 'youtube' && (
                    <div className="flex justify-center mt-6">
                      <YouTubeVideo videoId={example.media.src} />
                    </div>
                  )}
                </div>
              </CardHeader>
            </Card>
          </Tab>
        );
      })}
    </Tabs>
  );
}

export const LandingExamples: CarouselExample[] = [
  {
    icon: LuFileSpreadsheet,
    title: "Spreadsheet Copilot",
    description: "A powerful spreadsheet assistant that helps users analyze data, create formulas, and generate insights through natural language interaction.",
    media: {
      type: "video",
      src: "https://cdn.copilotkit.ai/docs/copilotkit/images/examples/spreadsheets.mp4"
    },
    links: {
      source: "https://github.com/CopilotKit/demo-spreadsheet",
      demo: "https://spreadsheet-demo-tau.vercel.app/",
    }
  },
  {
    icon: LuBanknote,
    title: "Banking Assistant (SaaS Copilot)",
    description: "An AI-powered banking interface that helps users manage transactions, analyze spending patterns, and get personalized financial advice.",
    media: {
      type: "video",
      src: "https://cdn.copilotkit.ai/docs/copilotkit/images/examples/banking.mp4"
    },
    links: {
      source: "https://github.com/CopilotKit/demo-banking",
      demo: "https://brex-demo-temp.vercel.app/",
    }
  },
  {
    icon: LuPlane,
    title: "Agent-Native Travel Planner (ANA)",
    description: "Interactive travel planning assistant that helps users discover destinations, create itineraries, and manage trip details with natural language.",
    media: {
      type: "video",
      src: "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/demo.mp4"
    },
    links: {
      source: "https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-travel?ref=travel-tutorial",
      demo: "https://examples-coagents-ai-travel-app.vercel.app/",
      tutorial: "/coagents/tutorials/ai-travel-app"
    }
  },
  {
    icon: LuBookOpen,
    title: "Agent-Native Research Canvas (ANA)",
    description: "An intelligent research assistant that helps users analyze academic papers, synthesize information across multiple sources, and generate comprehensive research summaries.",
    media: {
      type: "video",
      src: "https://cdn.copilotkit.ai/docs/copilotkit/images/examples/research.mp4"
    },
    links: {
      source: "https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-research-canvas/readme.md",
      demo: "https://examples-coagents-research-canvas-ui.vercel.app/",
      tutorial: "/coagents/videos/research-canvas"
    }
  }
];

export const CoAgentsExamples: CarouselExample[] = [
  {
    icon: LuLightbulb,
    title: "Introduction",
    description: "Hear from the CEO of CopilotKit, Atai Barkai, and learn how CoAgents are paving the way for the next generation of AI-native apps.",
    media: {
      type: "youtube",
      src: "tVjVYJE-Nic"
    },
    links: {
      demo: "https://examples-coagents-research-canvas-ui.vercel.app/",
    }
  },
  {
    icon: LuPlane,
    title: "Agent-Native Travel Planner (ANA)",
    description: "Interactive travel planning assistant that helps users discover destinations, create itineraries, and manage trip details with natural language.",
    media: {
      type: "video",
      src: "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/demo.mp4"
    },
    links: {
      source: "https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-travel?ref=travel-tutorial",
      demo: "https://examples-coagents-ai-travel-app.vercel.app/",
      tutorial: "/coagents/tutorials/ai-travel-app"
    }
  },
  {
    icon: LuBookOpen,
    title: "Agent-Native Research Canvas (ANA)",
    description: "An intelligent research assistant that helps users analyze academic papers, synthesize information across multiple sources, and generate comprehensive research summaries.",
    media: {
      type: "video",
      src: "https://cdn.copilotkit.ai/docs/copilotkit/images/examples/research.mp4"
    },
    links: {
      source: "https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-research-canvas/readme.md",
      demo: "https://examples-coagents-research-canvas-ui.vercel.app/",
      tutorial: "/coagents/videos/research-canvas"
    }
  }
]