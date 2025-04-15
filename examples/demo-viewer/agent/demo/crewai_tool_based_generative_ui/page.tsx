"use client";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { useState, useEffect } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";

// List of known valid image filenames (should match agent.py)
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
  "Mount_Fuji_Lake_Reflection_Cherry_Blossoms_Sakura_Spring.jpg"
];

export default function AgenticChat() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      agent="tool_based_generative_ui"
    >
      <div
        className="min-h-screen w-full flex items-center justify-center page-background"
        style={
          {
            "--copilot-kit-primary-color": "#222",
            "--copilot-kit-separator-color": "#CCC",
          } as CopilotKitCSSProperties
        }
      >
        <Haiku />
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            title: "Haiku Generator",
            initial: "I\'m a haiku generator 👋. How can I help you?",
          }}
          clickOutsideToClose={false}
        />
      </div>
    </CopilotKit>
  );
}

function Haiku() {
  const [haiku, setHaiku] = useState<{
    japanese: string[];
    english: string[];
    image_names: string[];
  }>({
    japanese: ["仮の句よ", "まっさらながら", "花を呼ぶ"],
    english: [
      "A placeholder verse—",
      "even in a blank canvas,",
      "it beckons flowers.",
    ],
    image_names: [],
  });
  const [isJustApplied, setIsJustApplied] = useState(false);

  const validateAndCorrectImageNames = (rawNames: string[] | undefined): string[] | null => {
    if (!rawNames || rawNames.length !== 3) {
      return null;
    }

    const correctedNames: string[] = [];
    const usedValidNames = new Set<string>();

    for (const name of rawNames) {
      if (VALID_IMAGE_NAMES.includes(name) && !usedValidNames.has(name)) {
        correctedNames.push(name);
        usedValidNames.add(name);
        if (correctedNames.length === 3) break;
      }
    }

    if (correctedNames.length < 3) {
      const availableFallbacks = VALID_IMAGE_NAMES.filter(name => !usedValidNames.has(name));
      for (let i = availableFallbacks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableFallbacks[i], availableFallbacks[j]] = [availableFallbacks[j], availableFallbacks[i]];
      }

      while (correctedNames.length < 3 && availableFallbacks.length > 0) {
        const fallbackName = availableFallbacks.pop();
        if (fallbackName) {
          correctedNames.push(fallbackName);
        }
      }
    }

    while (correctedNames.length < 3 && VALID_IMAGE_NAMES.length > 0) {
        const fallbackName = VALID_IMAGE_NAMES[Math.floor(Math.random() * VALID_IMAGE_NAMES.length)];
        correctedNames.push(fallbackName);
    }

    return correctedNames.slice(0, 3);
  };

  useCopilotAction({
    name: "generate_haiku",
    parameters: [
      {
        name: "japanese",
        type: "string[]",
      },
      {
        name: "english",
        type: "string[]",
      },
      {
        name: "image_names",
        type: "string[]",
        description: "Names of 3 relevant images",
      },
    ],
    followUp: false,
    handler: async () => {
      return "Haiku generated.";
    },
    render: ({ args: generatedHaiku, result, status }) => {
      const [isAppliedLocally, setIsAppliedLocally] = useState(false);

      let finalCorrectedImages: string[] | null = null;
      if (status === 'complete') {
        finalCorrectedImages = validateAndCorrectImageNames(generatedHaiku?.image_names);
      }

      return (
        <div className="suggestion-card text-left rounded-md p-4 mt-4 mb-4 flex flex-col bg-gray-100">
          <div
            className={"border-b border-gray-300 mb-4 pb-4"}
          >
            {generatedHaiku?.japanese?.map((line, index) => (
              <div className="flex items-center gap-3 mb-2" key={index}>
                <p className="text-lg font-bold">{line}</p>
                <p className="text-sm font-light">
                  {generatedHaiku.english?.[index]}
                </p>
              </div>
            ))}
            {generatedHaiku?.japanese && generatedHaiku.japanese.length >= 2 && (
              <div className="mt-3 flex gap-2 justify-between w-full suggestion-image-container">
                {finalCorrectedImages && finalCorrectedImages.map((imageName, imgIndex) => (
                  <img
                    key={imgIndex}
                    src={`/images/${imageName}`}
                    alt={imageName}
                    className="suggestion-card-image"
                  />
                ))}
                {(!finalCorrectedImages || finalCorrectedImages.length === 0) && (
                  <>
                    {[0, 1, 2].map((index) => (
                      <div
                        key={index}
                        className="suggestion-card-image bg-gray-200 animate-pulse"
                      >
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
            <button
              onClick={() => {
                setHaiku({
                  japanese: generatedHaiku.japanese || [],
                  english: generatedHaiku.english || [],
                  image_names: finalCorrectedImages || []
                });
                setIsAppliedLocally(true);
                setIsJustApplied(true);
                setTimeout(() => setIsJustApplied(false), 600);
              }}
              className="ml-auto px-3 py-1 bg-white text-black text-sm rounded cursor-pointer font-sm border "
            >
              {finalCorrectedImages && finalCorrectedImages.length > 0 ? isAppliedLocally ? "Applied ✓" : "Apply" : "..."}
            </button>
        </div>
      );
    },
  });
  return (
    <>
      <div className={`haiku-card animated-fade-in ${isJustApplied ? 'applied-flash' : ''}`}>
        {haiku?.japanese.map((line, index) => (
          <div
            className="flex items-start gap-4 mb-4 haiku-line"
            key={index}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <p className="text-4xl font-bold text-gray-600 w-auto">{line}</p>
            <p className="text-base font-light text-gray-500 w-auto">{haiku?.english?.[index]}</p>
          </div>
        ))}
        {haiku.image_names && haiku.image_names.length === 3 && (
          <div className="mt-6 flex gap-4 justify-center">
            {haiku.image_names.map((imageName, imgIndex) => (
              <img
                key={imgIndex}
                src={`/images/${imageName}`}
                alt={imageName}
                className="haiku-card-image"
                style={{ animationDelay: `${(haiku.japanese.length + imgIndex) * 0.1}s` }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}