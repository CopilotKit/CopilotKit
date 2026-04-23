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
  "Osaka_Castle_Turret_Stone_Wall_Pine_Trees_Daytime.jpg",
  "Tokyo_Skyline_Night_Tokyo_Tower_Mount_Fuji_View.jpg",
  "Itsukushima_Shrine_Miyajima_Floating_Torii_Gate_Sunset_Long_Exposure.jpg",
  "Takachiho_Gorge_Waterfall_River_Lush_Greenery_Japan.jpg",
  "Bonsai_Tree_Potted_Japanese_Art_Green_Foliage.jpeg",
  "Shirakawa-go_Gassho-zukuri_Thatched_Roof_Village_Aerial_View.jpg",
  "Ginkaku-ji_Silver_Pavilion_Kyoto_Japanese_Garden_Pond_Reflection.jpg",
  "Senso-ji_Temple_Asakusa_Cherry_Blossoms_Kimono_Umbrella.jpg",
  "Cherry_Blossoms_Sakura_Night_View_City_Lights_Japan.jpg",
  "Mount_Fuji_Lake_Reflection_Cherry_Blossoms_Sakura_Spring.jpg",
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
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-400/10 to-purple-400/10 rounded-full blur-3xl -z-0" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-indigo-400/10 to-pink-400/10 rounded-full blur-3xl -z-0" />

      <div className="relative z-10 flex flex-col items-center space-y-6">
        {haiku.japanese?.map((line, index) => (
          <div
            key={index}
            className="flex flex-col items-center text-center space-y-2"
            style={{ animationDelay: `${index * 100}ms` }}
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

      {haiku.image_name && (
        <div className="relative z-10 mt-8 pt-8 border-t border-slate-200">
          <div className="relative group overflow-hidden rounded-2xl shadow-xl">
            <img
              data-testid="haiku-image"
              src={`/images/${haiku.image_name}`}
              alt={haiku.image_name}
              className="object-cover w-full h-64 md:h-80 transform transition-transform duration-500 group-hover:scale-105"
            />
          </div>
        </div>
      )}
    </div>
  );
}
