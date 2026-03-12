"use client";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useCallback, useMemo, useState } from "react";
import { Slide } from "./Slide";
import { Header } from "./Header";
import useAppendSlide from "../../actions/useAppendSlide";
import { SlideModel } from "@/app/types";

interface PresentationProps {
  performResearch: boolean;
  setPerformResearch: (fn: (b: boolean) => boolean) => void;
}

export const Presentation = ({
  performResearch,
  setPerformResearch,
}: PresentationProps) => {
  const [slides, setSlides] = useState<SlideModel[]>([
    {
      content: "This is the first slide.",
      backgroundImageUrl:
        "https://loremflickr.com/cache/resized/65535_53415810728_d1db6e2660_h_800_600_nofilter.jpg",
      spokenNarration: "This is the first slide. Welcome to our presentation!",
    },
  ]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const currentSlide = useMemo(
    () => slides[currentSlideIndex],
    [slides, currentSlideIndex]
  );

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

  const updateCurrentSlide = useCallback(
    (partialSlide: Partial<SlideModel>) => {
      setSlides((slides) => [
        ...slides.slice(0, currentSlideIndex),
        { ...slides[currentSlideIndex], ...partialSlide },
        ...slides.slice(currentSlideIndex + 1),
      ]);
    },
    [currentSlideIndex, setSlides]
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
