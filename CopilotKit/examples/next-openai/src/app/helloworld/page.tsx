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

const HelloWorld = () => {
  return (
    <CopilotKit url="/api/copilotkit/openai">
      <CopilotSidebar
        clickOutsideToClose={false}
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
      description: "Present a slide in the presentation you are giving.",
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
            "What to display in the background of the slide (i.e. 'dog' or 'house'), or 'none' for a blank background",
          required: true,
        },
      ],

      implementation: async (message, backgroundImage) => {
        setState({
          message: message,
          backgroundImage: backgroundImage,
        });
      },
    },
    [],
  );

  const randomSlideTask = new CopilotTask({
    instructions: "Make a random slide",
    context: useCopilotContext(),
  });

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
            await randomSlideTask.run();
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
