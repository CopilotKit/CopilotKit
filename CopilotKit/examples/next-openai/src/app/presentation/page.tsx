"use client";

import { useCopilotContext } from "@copilotkit/react-core";
import { CopilotTask } from "@copilotkit/react-core";
import {
  CopilotKit,
  useMakeCopilotActionable,
  useMakeCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { use, useEffect, useState } from "react";
import Markdown from "react-markdown";
import "./styles.css";

let globalAudio: any = undefined;
let globalAudioEnabled = false;

function enableAudioOnUserInteraction() {
  if (!globalAudioEnabled) {
    globalAudio.play();
    globalAudio.pause();
  }
  globalAudioEnabled = true;
}

const Demo = () => {
  const [chatInProgress, setChatInProgress] = useState(false);
  return (
    <CopilotKit url="/api/copilotkit/presentation">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          title: "Presentation Copilot",
          initial: "Hi you! 👋 I can give you a presentation on any topic.",
        }}
        clickOutsideToClose={false}
        onSubmitMessage={async (message) => {
          enableAudioOnUserInteraction();
        }}
        onInProgress={(inProgress) => {
          setChatInProgress(inProgress);
        }}
      >
        <Presentation chatInProgress={chatInProgress} />
      </CopilotSidebar>
    </CopilotKit>
  );
};

interface Slide {
  markdown: string;
  backgroundImage: string;
  speech: string;
}

async function speak(text: string) {
  globalAudio.pause();
  globalAudio.currentTime = 0;
  const encodedText = encodeURIComponent(text);
  const url = `/api/tts?text=${encodedText}`;
  globalAudio.src = url;
  globalAudio.play();
  await new Promise<void>((resolve) => {
    globalAudio.onended = function () {
      resolve();
    };
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const Presentation = ({ chatInProgress }: { chatInProgress: boolean }) => {
  const [slides, setSlides] = useState<Slide[]>([
    {
      markdown: `# Welcome to our presentation!`,
      backgroundImage: "hello",
      speech: "Welcome to our presentation!",
    },
  ]);

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  useEffect(() => {
    if (!globalAudio) {
      globalAudio = new Audio();
    }
  }, []);

  const currentSlide = slides[currentSlideIndex];

  useMakeCopilotReadable("These are all the slides: " + JSON.stringify(slides));
  useMakeCopilotReadable("This is the current slide: " + JSON.stringify(currentSlide));

  useMakeCopilotActionable(
    {
      name: "addSlide",
      description:
        "Add a slide in the presentation you are giving. Call this function multiple times to present multiple slides.\n" +
        "After you get new information, you must call this function to present the results.",
      argumentAnnotations: [
        {
          name: "markdown",
          type: "string",
          description:
            "The text to display in the presentation slide. Use simple markdown to outline your speech, like a headline, lists, paragraphs, etc.",
          required: true,
        },
        {
          name: "backgroundImage",
          type: "string",
          description: "What to display in the background of the slide (i.e. 'dog' or 'house').",
          required: true,
        },
        {
          name: "speech",
          type: "string",
          description: "An informative speech about the current slide.",
          required: true,
        },
      ],

      implementation: async (markdown, backgroundImage, speech) => {
        console.log("Presenting slide: ", markdown, backgroundImage, speech);
        setSlides((slides) => [...slides, { markdown, backgroundImage, speech }]);
        setCurrentSlideIndex((i) => i + 1);
        await speak(speech);
      },
    },
    [],
  );

  const context = useCopilotContext();
  const nextSlideTask = new CopilotTask({
    instructions: "Make the next slide related to the current topic",
  });

  const [randomSlideTaskRunning, setRandomSlideTaskRunning] = useState(false);

  let nextSlideLabel = "Next Slide";
  if (randomSlideTaskRunning) {
    nextSlideLabel = "Generating slide...";
  } else if (currentSlideIndex + 1 === slides.length) {
    nextSlideLabel = "Generate Next Slide";
  }

  const nextDisabled = randomSlideTaskRunning || chatInProgress;
  const prevDisabled = randomSlideTaskRunning || currentSlideIndex === 0 || chatInProgress;

  return (
    <div className="relative">
      <SlideComponent {...currentSlide} />
      <button
        disabled={nextDisabled}
        className={`absolute bottom-0 right-0 mb-6 mr-32 bg-blue-500 text-white font-bold py-2 px-4 rounded
        ${nextDisabled ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"}`}
        onClick={async () => {
          enableAudioOnUserInteraction();

          if (currentSlideIndex + 1 === slides.length) {
            try {
              setRandomSlideTaskRunning(true);
              await nextSlideTask.run(context);
            } finally {
              setRandomSlideTaskRunning(false);
            }
          } else {
            setCurrentSlideIndex((i) => i + 1);
            speak(slides[currentSlideIndex + 1].speech);
          }
        }}
      >
        {nextSlideLabel}
      </button>

      <button
        disabled={prevDisabled}
        className={`absolute bottom-0 left-0 mb-6 ml-4 bg-blue-500 text-white font-bold py-2 px-4 rounded
        ${prevDisabled ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"}`}
        onClick={async () => {
          if (currentSlideIndex > 0) {
            setCurrentSlideIndex((i) => i - 1);
            speak(slides[currentSlideIndex - 1].speech);
          }
        }}
      >
        Previous Slide
      </button>
    </div>
  );
};

const SlideComponent = ({ markdown, backgroundImage }: Slide) => {
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
