"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

interface Proverb {
  text: string;
  gradient: string;
}

export default function GenUiToolBasedDemo() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-tool-based">
        <SidebarWithSuggestions />
        <ProverbsDisplay />
      </CopilotKit>
    </div>
  );
}

function SidebarWithSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "AI Proverb",
        message: "Create a proverb about artificial intelligence.",
      },
      {
        title: "Nature Proverb",
        message: "Create a proverb about nature and patience.",
      },
      {
        title: "Wisdom Proverb",
        message: "Generate a proverb about the value of wisdom.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotSidebar
      defaultOpen={true}
      labels={{
        modalHeaderTitle: "Proverb Generator",
      }}
    />
  );
}

function ProverbsDisplay() {
  const [proverbs, setProverbs] = useState<Proverb[]>([
    {
      text: "CopilotKit may be new, but it's the best thing since sliced bread.",
      gradient: "linear-gradient(to bottom right, #f8fafc, #eff6ff)",
    },
  ]);

  useFrontendTool(
    {
      name: "generate_proverb",
      parameters: z.object({
        text: z.string().describe("The proverb text"),
        gradient: z.string().describe("CSS Gradient color for the background"),
      }),
      followUp: false,
      handler: async ({
        text,
        gradient,
      }: {
        text: string;
        gradient: string;
      }) => {
        const newProverb: Proverb = {
          text: text || "",
          gradient: gradient || "",
        };
        setProverbs((prev) => [
          newProverb,
          ...prev.filter(
            (p) =>
              p.text !==
              "CopilotKit may be new, but it's the best thing since sliced bread.",
          ),
        ]);
        return "Proverb generated!";
      },
      render: ({ args }: { args: Partial<Proverb> }) => {
        if (!args.text) return <></>;
        return <ProverbCard proverb={args as Proverb} />;
      },
    },
    [proverbs],
  );

  return (
    <div className="relative flex items-center justify-center h-full w-full">
      <div style={{ padding: "48px 80px", width: "100%", maxWidth: "56rem" }}>
        <div className="space-y-6">
          {proverbs.map((proverb, index) => (
            <ProverbCard key={index} proverb={proverb} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProverbCard({ proverb }: { proverb: Partial<Proverb> }) {
  return (
    <div
      data-testid="proverb-card"
      style={{
        position: "relative",
        borderRadius: "16px",
        margin: "24px 0",
        padding: "32px",
        maxWidth: "42rem",
        border: "1px solid #e2e8f0",
        overflow: "hidden",
        background:
          proverb.gradient ||
          "linear-gradient(to bottom right, #f8fafc, #eff6ff)",
      }}
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-400/10 to-purple-400/10 rounded-full blur-3xl -z-0" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-indigo-400/10 to-pink-400/10 rounded-full blur-3xl -z-0" />

      <div className="relative z-10 flex flex-col items-center space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <p
            data-testid="proverb-text"
            className="font-serif font-bold text-2xl md:text-3xl bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent tracking-wide leading-relaxed"
          >
            &ldquo;{proverb.text}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}
