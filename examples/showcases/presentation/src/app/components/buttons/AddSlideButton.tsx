import { SlideModel } from "@/app/types";
import { ActionButton } from "./ActionButton";
import { PlusCircleIcon } from "@heroicons/react/24/outline";

interface AddSlideButtonProps {
  currentSlideIndex: number;
  setCurrentSlideIndex: (fn: (i: number) => number) => void;
  setSlides: (fn: (slides: SlideModel[]) => SlideModel[]) => void;
}

export function AddSlideButton({
  currentSlideIndex,
  setCurrentSlideIndex,
  setSlides,
}: AddSlideButtonProps) {
  return (
    <ActionButton
      onClick={() => {
        const newSlide: SlideModel = {
          content: "",
          backgroundImageUrl:
            "https://loremflickr.com/cache/resized/65535_53415810728_d1db6e2660_h_800_600_nofilter.jpg",
          spokenNarration: "",
        };
        setSlides((slides) => [
          ...slides.slice(0, currentSlideIndex + 1),
          newSlide,
          ...slides.slice(currentSlideIndex + 1),
        ]);
        setCurrentSlideIndex((i) => i + 1);
      }}
    >
      <PlusCircleIcon className="h-5 w-5" />
    </ActionButton>
  );
}
