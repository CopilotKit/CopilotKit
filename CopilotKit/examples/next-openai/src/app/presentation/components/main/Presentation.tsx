"use client";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { useCallback, useMemo, useState } from "react";
import { Slide } from "./Slide";
import { Header } from "./Header";
import useAppendSlide from "../../actions/useAppendSlide";
import { SlideModel } from "../../types";

interface PresentationProps {
  performResearch: boolean;
  setPerformResearch: (fn: (b: boolean) => boolean) => void;
}

export const Presentation = ({ performResearch, setPerformResearch }: PresentationProps) => {
  // // Load messages from local storage

  // const { messages, setMessages } = useCopilotMessagesContext();

  // // save to local storage when messages change
  // useEffect(() => {
  //   if (messages.length !== 0) {
  //     localStorage.setItem("copilotkit-messages", JSON.stringify(messages));
  //   }
  // }, [JSON.stringify(messages)]);

  // // initially load from local storage
  // useEffect(() => {
  //   const messages = localStorage.getItem("copilotkit-messages");
  //   if (messages) {
  //     const parsedMessages = JSON.parse(messages).map((message: any) => {
  //       if (message.type === "TextMessage") {
  //         return new TextMessage({
  //           id: message.id,
  //           role: message.role,
  //           content: message.content,
  //           createdAt: message.createdAt,
  //         });
  //       } else if (message.type === "ActionExecutionMessage") {
  //         return new ActionExecutionMessage({
  //           id: message.id,
  //           name: message.name,
  //           scope: message.scope,
  //           arguments: message.arguments,
  //           createdAt: message.createdAt,
  //         });
  //       } else if (message.type === "ResultMessage") {
  //         return new ResultMessage({
  //           id: message.id,
  //           actionExecutionId: message.actionExecutionId,
  //           actionName: message.actionName,
  //           result: message.result,
  //           createdAt: message.createdAt,
  //         });
  //       } else {
  //         throw new Error(`Unknown message type: ${message.type}`);
  //       }
  //     });
  //     setMessages(parsedMessages);
  //   }
  // }, []);

  const [slides, setSlides] = useState<SlideModel[]>([
    {
      content: "This is the first slide.",
      backgroundImageUrl:
        "https://loremflickr.com/cache/resized/65535_53415810728_d1db6e2660_h_800_600_nofilter.jpg",
      spokenNarration: "This is the first slide. Welcome to our presentation!",
      backgroundImageDescription: "A default image placeholder",
    },
  ]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const currentSlide = useMemo(() => slides[currentSlideIndex], [slides, currentSlideIndex]);

  /**
   * This makes all slides available to the Copilot.
   */
  useCopilotReadable({
    description: "These are all the slides",
    value: slides,
  });

  /**
   * This makes the current slide available to the Copilot.
   */
  useCopilotReadable({
    description: "This is the current slide",
    value: currentSlide,
  });

  /**
   * This action allows the Copilot to append a new slide to the presentation.
   */
  useAppendSlide({
    setSlides,
    setCurrentSlideIndex,
    slides,
  });

  /**
   * Auto Suggestions
   */
  useCopilotChatSuggestions(
    {
      instructions: "Suggest a new slide based on the existing slides.",
    },
    [currentSlide],
  );

  useCopilotChatSuggestions(
    {
      instructions:
        "Suggest specifically what could be improved about the content of current slide. " +
        "The specific suggestion should be in the button text. " +
        "Do not suggest to update the background image.",
      minSuggestions: 0,
      maxSuggestions: 1,
      className: "custom-suggestion",
    },
    [currentSlide],
  );

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
    <div
      style={{
        height: `100vh`,
      }}
      className="flex flex-col"
    >
      <Header
        currentSlideIndex={currentSlideIndex}
        setCurrentSlideIndex={setCurrentSlideIndex}
        slides={slides}
        setSlides={setSlides}
        performResearch={performResearch}
        setPerformResearch={setPerformResearch}
      />
      <div
        className="flex items-center justify-center flex-1"
        style={{ backgroundColor: "#414247", overflow: "auto" }}
      >
        <div
          className="aspect-ratio-box bg-white flex shadow-2xl"
          style={{ margin: "5rem", maxHeight: "70vh" }}
        >
          <Slide slide={currentSlide} partialUpdateSlide={updateCurrentSlide} />
        </div>
      </div>
    </div>
  );
};
