import clsx from "clsx";
import { SlideModel } from "../../types";
import { useMemo } from "react";
import { useCopilotContext } from "@copilotkit/react-core";
import { SlideNumberIndicator } from "../misc/SlideNumberIndicator";
import { GenerateSlideButton } from "../buttons/GenerateSlideButton";
import { SpeakCurrentSlideButton } from "../buttons/SpeakCurrentSlideButton";
import { DeleteSlideButton } from "../buttons/DeleteSlideButton";
import { NavButton } from "../buttons/NavButton";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { PerformResearchSwitch } from "../buttons/PerformResearchSwitch";
import { AddSlideButton } from "../buttons/AddSlideButton";

interface HeaderProps {
  currentSlideIndex: number;
  setCurrentSlideIndex: (fn: (i: number) => number) => void;
  slides: SlideModel[];
  setSlides: (fn: (slides: SlideModel[]) => SlideModel[]) => void;
  performResearch: boolean;
  setPerformResearch: (fn: (b: boolean) => boolean) => void;
}

export function Header({
  currentSlideIndex,
  setCurrentSlideIndex,
  slides,
  setSlides,
  performResearch,
  setPerformResearch,
}: HeaderProps) {
  const currentSlide = useMemo(() => slides[currentSlideIndex], [slides, currentSlideIndex]);

  /**
   * We need to get the context here to run a Copilot task for generating a slide
   **/
  const context = useCopilotContext();

  return (
    <header className={clsx("text-white items-center flex p-4")}>
      <div className="flex-0 flex space-x-1">
        {/* Back */}
        <NavButton
          disabled={currentSlideIndex == 0}
          onClick={() => setCurrentSlideIndex((i) => i - 1)}
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </NavButton>

        {/* Forward */}
        <NavButton
          disabled={currentSlideIndex == slides.length - 1}
          onClick={() => setCurrentSlideIndex((i) => i + 1)}
        >
          <ChevronRightIcon className="h-6 w-6" />
        </NavButton>

        {/* Perform Research */}
        <PerformResearchSwitch isEnabled={performResearch} setIsEnabled={setPerformResearch} />
      </div>

      <SlideNumberIndicator {...{ currentSlideIndex, totalSlides: slides.length }} />

      <div className="flex-0 flex space-x-1">
        <AddSlideButton {...{ currentSlideIndex, setCurrentSlideIndex, setSlides }} />

        <GenerateSlideButton context={context} />

        <SpeakCurrentSlideButton spokenNarration={currentSlide.spokenNarration} />

        <DeleteSlideButton {...{ currentSlideIndex, setCurrentSlideIndex, slides, setSlides }} />
      </div>
    </header>
  );
}
