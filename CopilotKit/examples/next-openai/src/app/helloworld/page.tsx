"use client";

import { useCopilotContext } from "@copilotkit/react-core";
import { CopilotTask } from "@copilotkit/react-core";
import {
  CopilotKit,
  useMakeCopilotActionable,
  useMakeCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useState } from "react";

function getVoice(language: string) {
  const voicesByLanguage = {};
  for (const voice of window.speechSynthesis.getVoices()) {
    const lang = voice.lang.split("-")[0];
    voicesByLanguage[lang] ||= [];
    voicesByLanguage[lang].push(voice);
  }

  const voices = voicesByLanguage[language] || voicesByLanguage["en"];
  for (const voice of voices) {
    if (language == "en" && voice.name.includes("Karen")) {
      // Karen sounds ok
      return voice;
    } else if (language == "de" && voice.name.includes("Anna")) {
      // Anna sounds quite good
      return voice;
    }
  }
  return voices[0];
}

const HelloWorld = () => {
  return (
    <CopilotKit url="/api/copilotkit/openai">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          title: "Presentation Copilot",
          initial: "Hi you! 👋 I can give you a presentation on any topic.",
        }}
      >
        <Presentation />
      </CopilotSidebar>
    </CopilotKit>
  );
};

const Presentation = () => {
  const [state, setState] = useState({
    message: "Hello World!",
    backgroundImage: "none",
  });

  useMakeCopilotReadable("This is the current slide: " + JSON.stringify(state));

  useMakeCopilotActionable(
    {
      name: "presentSlide",
      description:
        "Present a slide in the presentation you are giving. Call this function multiple times to present multiple slides.",
      argumentAnnotations: [
        {
          name: "message",
          type: "string",
          description:
            "A message to display in the presentation slide, max 30 words, but make it informative.",
          required: true,
        },
        {
          name: "backgroundImage",
          type: "string",
          description:
            "What to display in the background of the slide (i.e. 'dog' or 'house')",
          required: true,
        },
        {
          name: "speech",
          type: "string",
          description: "An informative speech about the current slide.",
          required: true,
        },
        {
          name: "language",
          type: "string",
          description: "The language code used for the speech.",
          required: false,
        },
      ],

      implementation: async (message, backgroundImage, speech, language) => {
        setState({
          message: message,
          backgroundImage: backgroundImage,
        });

        if (window.speechSynthesis !== undefined) {
          const utterance = new SpeechSynthesisUtterance(speech);
          utterance.voice = getVoice(language || "en");

          const speechFinished = new Promise<void>((resolve) => {
            utterance.onend = function () {
              resolve();
            };
          });

          window.speechSynthesis.speak(utterance);

          await speechFinished;

          // wait a bit before continuing
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      },
    },
    [],
  );

  const randomSlideTask = new CopilotTask({
    instructions: "Make a random slide related to the current topic",
  });

  const context = useCopilotContext();

  const [randomSlideTaskRunning, setRandomSlideTaskRunning] = useState(false);

  return (
    <div className="relative">
      <Slide {...state} />
      <button
        disabled={randomSlideTaskRunning}
        className={`absolute bottom-0 left-0 mb-4 ml-4 bg-blue-500 text-white font-bold py-2 px-4 rounded
        ${randomSlideTaskRunning ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"}`}
        onClick={async () => {
          try {
            setRandomSlideTaskRunning(true);
            await randomSlideTask.run(context);
          } finally {
            setRandomSlideTaskRunning(false);
          }
        }}
      >
        {randomSlideTaskRunning ? "Generating slide..." : "Make random slide"}
      </button>
    </div>
  );
};

type SlideProps = {
  message: string;
  backgroundImage: string;
};

const Slide = ({ message, backgroundImage }: SlideProps) => {
  if (backgroundImage !== "none") {
    backgroundImage =
      'url("https://source.unsplash.com/featured/?' + encodeURIComponent(backgroundImage) + '")';
  }
  return (
    <div
      className="h-screen w-full flex flex-col justify-center items-center text-5xl text-white bg-cover bg-center bg-no-repeat p-10 text-center"
      style={{
        backgroundImage,
        textShadow: "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
      }}
    >
      {message}
    </div>
  );
};

export default HelloWorld;
