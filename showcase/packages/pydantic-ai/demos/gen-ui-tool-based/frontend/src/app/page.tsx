"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

interface Haiku {
  japanese: string[];
  english: string[];
  image_name: string | null;
  gradient: string;
}

export default function GenUiToolBasedDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-tool-based">
      <SidebarWithSuggestions />
      <HaikuDisplay />
    </CopilotKit>
  );
}

function SidebarWithSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Nature Haiku", message: "Write me a haiku about nature." },
      { title: "Ocean Haiku", message: "Create a haiku about the ocean." },
      { title: "Spring Haiku", message: "Generate a haiku about spring." },
    ],
    available: "always",
  });

  return (
    <CopilotSidebar
      defaultOpen={true}
      labels={{
        modalHeaderTitle: "Haiku Generator",
      }}
    />
  );
}

const VALID_IMAGE_NAMES = [
  "Mount_Fuji_Lake_Reflection_Cherry_Blossoms_Sakura_Spring.jpg",
  "Cherry_Blossoms_Sakura_Night_View_City_Lights_Japan.jpg",
];

function HaikuDisplay() {
  const [haikus, setHaikus] = useState<Haiku[]>([
    {
      japanese: ["仮の句よ", "まっさらながら", "花を呼ぶ"],
      english: [
        "A placeholder verse--",
        "even in a blank canvas,",
        "it beckons flowers.",
      ],
      image_name: null,
      gradient: "",
    },
  ]);

  useFrontendTool(
    {
      name: "generate_haiku",
      parameters: z.object({
        japanese: z.array(z.string()).describe("3 lines of haiku in Japanese"),
        english: z
          .array(z.string())
          .describe("3 lines of haiku translated to English"),
        image_name: z
          .string()
          .describe(
            `One relevant image name from: ${VALID_IMAGE_NAMES.join(", ")}`,
          ),
        gradient: z.string().describe("CSS Gradient color for the background"),
      }),
      followUp: false,
      handler: async ({
        japanese,
        english,
        image_name,
        gradient,
      }: {
        japanese: string[];
        english: string[];
        image_name: string;
        gradient: string;
      }) => {
        const newHaiku: Haiku = {
          japanese: japanese || [],
          english: english || [],
          image_name: image_name || null,
          gradient: gradient || "",
        };
        setHaikus((prev) => [
          newHaiku,
          ...prev.filter((h) => h.english[0] !== "A placeholder verse--"),
        ]);
        return "Haiku generated!";
      },
      render: ({ args }: { args: Partial<Haiku> }) => {
        if (!args.japanese) return <></>;
        return <HaikuCard haiku={args as Haiku} />;
      },
    },
    [haikus],
  );

  return (
    <div className="relative flex items-center justify-center h-full w-full">
      <div className="px-20 py-12 w-full max-w-4xl">
        <div className="space-y-6">
          {haikus.map((haiku, index) => (
            <HaikuCard key={index} haiku={haiku} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HaikuCard({ haiku }: { haiku: Partial<Haiku> }) {
  return (
    <div
      data-testid="haiku-card"
      style={{ background: haiku.gradient }}
      className="relative bg-gradient-to-br from-slate-50 to-blue-50 rounded-2xl my-6 p-8 max-w-2xl border border-slate-200 overflow-hidden"
    >
      <div className="relative z-10 flex flex-col items-center space-y-6">
        {haiku.japanese?.map((line, index) => (
          <div
            key={index}
            className="flex flex-col items-center text-center space-y-2"
          >
            <p
              data-testid="haiku-japanese-line"
              className="font-serif font-bold text-4xl md:text-5xl bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent tracking-wide"
            >
              {line}
            </p>
            <p
              data-testid="haiku-english-line"
              className="font-light text-base md:text-lg text-slate-600 italic max-w-md"
            >
              {haiku.english?.[index]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
