"use client";

import { useCopilotContext } from "@copilotkit/react-core";
import { CopilotTask } from "@copilotkit/react-core";
import { CopilotKit, useMakeCopilotReadable } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import "./styles.css";
import { useCopilotAction } from "@copilotkit/react-core";

let globalAudio: any = undefined;
let globalAudioEnabled = false;

function enableGlobalAudio() {
  if (!globalAudioEnabled) {
    globalAudio.play();
    globalAudio.pause();
  }
  globalAudioEnabled = true;
}

const Demo = () => {
  return (
    <CopilotKit url="/api/copilotkit/openai">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          title: "Presentation Copilot",
          initial: "Hi you! 👋 I can give you a presentation on any topic.",
        }}
        clickOutsideToClose={false}
        onSubmitMessage={async (message) => {
          enableGlobalAudio();
        }}
      >
        <Presentation />
      </CopilotSidebar>
    </CopilotKit>
  );
};

const Presentation = () => {
  const [state, setState] = useState({
    markdown: `# Hello World!`,
    backgroundImage: "hello",
  });

  useEffect(() => {
    if (!globalAudio) {
      globalAudio = new Audio();
    }
  }, []);

  useMakeCopilotReadable("This is the current slide: " + JSON.stringify(state));

  useCopilotAction({
    name: "presentSlide",
    description:
      "Present a slide in the presentation you are giving. Call this function multiple times to present multiple slides.",
    parameters: [
      {
        name: "markdown",
        type: "string",
        description:
          "The text to display in the presentation slide. Use simple markdown to outline your speech, like a headline, lists, paragraphs, etc.",
      },
      {
        name: "backgroundImage",
        type: "string",
        description: "What to display in the background of the slide (i.e. 'dog' or 'house').",
      },
      {
        name: "speech",
        type: "string",
        description: "An informative speech about the current slide.",
      },
    ],
    handler: async ({ markdown, speech, backgroundImage }) => {
      setState({
        markdown,
        backgroundImage,
      });

      console.log("Presenting slide: ", markdown, backgroundImage, speech);

      const encodedText = encodeURIComponent(speech);
      const url = `/api/tts?text=${encodedText}`;
      globalAudio.src = url;
      await globalAudio.play();
      await new Promise<void>((resolve) => {
        globalAudio.onended = function () {
          resolve();
        };
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    render: (props) => {
      return <div className="bg-red-500">{props.status}</div>;
    },
  });

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
          enableGlobalAudio();
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
  markdown: string;
  backgroundImage: string;
};

const Slide = ({ markdown, backgroundImage }: SlideProps) => {
  backgroundImage =
    'url("https://source.unsplash.com/featured/?' + encodeURIComponent(backgroundImage) + '")';
  return (
    <div
      className="h-screen w-full flex flex-col justify-center items-center text-5xl text-white bg-cover bg-center bg-no-repeat p-10 text-center"
      style={{
        backgroundImage,
        textShadow: "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
      }}
    >
      <Markdown className="markdown">{markdown}</Markdown>
    </div>
  );
};

export default Demo;
