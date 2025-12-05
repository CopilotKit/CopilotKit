"use client";
import { useCopilotAction, useCopilotContext } from "@copilotkit/react-core";
import { CopilotTask } from "@copilotkit/react-core";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useCallback, useMemo, useState } from "react";
import {
  BackwardIcon,
  ForwardIcon,
  PlusIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { resetGlobalAudio, speak } from "../utils";
import { ActionButton } from "./ActionButton";
import { SlideModel, Slide } from "./Slide";

export const Presentation = ({ chatInProgress }: { chatInProgress: boolean }) => {
  const [slides, setSlides] = useState<SlideModel[]>([
    {
      title: `Welcome to our presentation!`,
      content: "This is the first slide.",
      backgroundImageDescription: "hello",
      spokenNarration: "This is the first slide. Welcome to our presentation!",
    },
  ]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const currentSlide = useMemo(() => slides[currentSlideIndex], [slides, currentSlideIndex]);

  useCopilotReadable({
    description: "These are all the slides",
    value: slides,
  });
  useCopilotReadable({
    description: "This is the current slide",
    value: currentSlide,
  });

  useCopilotAction({
    name: "appendSlide",
    description:
      "Add a slide after all the existing slides. Call this function multiple times to add multiple slides.",
    parameters: [
      {
        name: "title",
        type: "string",
        description: "The title of the slide. Should be a few words long.",
      },
      {
        name: "content",
        type: "string",
        description: "The content of the slide. Should generally consists of a few bullet points.",
      },
      {
        name: "backgroundImageDescription",
        type: "string",
        description:
          "What to display in the background of the slide. For example, 'dog', 'house', etc.",
      },
      {
        name: "spokenNarration",
        type: "string",
        description:
          "The text to read while presenting the slide. Should be distinct from the slide's content, and can include additional context, references, etc. Will be read aloud as-is. Should be a few sentences long, clear, and smooth to read.",
      },
    ],
    handler: async ({ title, content, backgroundImageDescription, spokenNarration }) => {
      const newSlide: SlideModel = {
        title,
        content,
        backgroundImageDescription,
        spokenNarration,
      };

      setSlides((slides) => [...slides, newSlide]);
    },
    render: "Adding slide...",
  });

  const context = useCopilotContext();
  const generateSlideTask = new CopilotTask({
    instructions:
      "Make the next slide related to the overall topic of the presentation. It will be inserted after the current slide.",
  });
  const [generateSlideTaskRunning, setGenerateSlideTaskRunning] = useState(false);

  const updateCurrentSlide = useCallback(
    (partialSlide: Partial<SlideModel>) => {
      setSlides((slides) => [
        ...slides.slice(0, currentSlideIndex),
        { ...slides[currentSlideIndex], ...partialSlide },
        ...slides.slice(currentSlideIndex + 1),
      ]);
    },
    [currentSlideIndex, setSlides],
  );

  return (
    <div className="relative">
      <Slide slide={currentSlide} partialUpdateSlide={updateCurrentSlide} />

      {/* Add the action buttons below */}
      <div className="absolute top-0 left-0 mt-6 ml-4 z-30">
        <ActionButton
          disabled={generateSlideTaskRunning || chatInProgress}
          onClick={() => {
            const newSlide: SlideModel = {
              title: "Title",
              content: "Body",
              backgroundImageDescription: "random",
              spokenNarration: "The speaker's notes for this slide.",
            };
            setSlides((slides) => [
              ...slides.slice(0, currentSlideIndex + 1),
              newSlide,
              ...slides.slice(currentSlideIndex + 1),
            ]);
            setCurrentSlideIndex((i) => i + 1);
          }}
          className="rounded-r-none"
        >
          <PlusIcon className="h-6 w-6" />
        </ActionButton>
        <ActionButton
          disabled={generateSlideTaskRunning || chatInProgress}
          onClick={async () => {
            setGenerateSlideTaskRunning(true);
            await generateSlideTask.run(context);
            setGenerateSlideTaskRunning(false);
          }}
          className="rounded-l-none ml-[1px]"
        >
          <SparklesIcon className="h-6 w-6" />
        </ActionButton>
      </div>

      <div className="absolute top-0 right-0 mt-6 mr-24">
        <ActionButton
          disabled={generateSlideTaskRunning || chatInProgress || slides.length === 1}
          onClick={() => {
            // delete the current slide
            setSlides((slides) => [
              ...slides.slice(0, currentSlideIndex),
              ...slides.slice(currentSlideIndex + 1),
            ]);
            setCurrentSlideIndex((i) => 0);
          }}
          className="ml-5 rounded-r-none"
        >
          <TrashIcon className="h-6 w-6" />
        </ActionButton>

        <ActionButton
          disabled={generateSlideTaskRunning || chatInProgress}
          onClick={() => {
            resetGlobalAudio();
            speak(currentSlide.spokenNarration);
          }}
          className="rounded-l-none rounded-r-none ml-[1px]"
        >
          <SpeakerWaveIcon className="h-6 w-6" />
        </ActionButton>
      </div>

      <div
        className="absolute bottom-0 right-0 mb-20 mx-24 text-xl"
        style={{
          textShadow: "1px 1px 0 #ddd, -1px -1px 0 #ddd, 1px -1px 0 #ddd, -1px 1px 0 #ddd",
        }}
      >
        Slide {currentSlideIndex + 1} of {slides.length}
      </div>

      <div className="absolute bottom-0 right-0 mb-6 mx-24">
        <ActionButton
          className="rounded-r-none"
          disabled={generateSlideTaskRunning || currentSlideIndex === 0 || chatInProgress}
          onClick={() => {
            setCurrentSlideIndex((i) => i - 1);
          }}
        >
          <BackwardIcon className="h-6 w-6" />
        </ActionButton>
        <ActionButton
          className="mr-[1px] rounded-l-none"
          disabled={
            generateSlideTaskRunning || chatInProgress || currentSlideIndex + 1 === slides.length
          }
          onClick={async () => {
            setCurrentSlideIndex((i) => i + 1);
          }}
        >
          <ForwardIcon className="h-6 w-6" />
        </ActionButton>
      </div>
    </div>
  );
};
