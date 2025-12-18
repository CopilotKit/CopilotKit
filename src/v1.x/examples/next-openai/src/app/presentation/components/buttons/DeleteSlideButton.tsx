import { SlideModel } from "../../types";
import { ActionButton } from "./ActionButton";
import { TrashIcon } from "@heroicons/react/24/outline";

interface DeleteSlideButtonProps {
  currentSlideIndex: number;
  setCurrentSlideIndex: (fn: (i: number) => number) => void;
  slides: SlideModel[];
  setSlides: (fn: (slides: SlideModel[]) => SlideModel[]) => void;
}

export function DeleteSlideButton({
  currentSlideIndex,
  setCurrentSlideIndex,
  slides,
  setSlides,
}: DeleteSlideButtonProps) {
  return (
    <ActionButton
      disabled={slides.length == 1}
      onClick={() => {
        // delete the current slide
        setSlides((slides) => [
          ...slides.slice(0, currentSlideIndex),
          ...slides.slice(currentSlideIndex + 1),
        ]);
        setCurrentSlideIndex((i) => 0);
      }}
    >
      <TrashIcon className="h-5 w-5" />
    </ActionButton>
  );
}
