import { useCopilotAction } from "@copilotkit/react-core";
import { SlideModel } from "../types";
import { SlidePreview } from "../components/misc/SlidePreview";

interface AppendSlideParams {
  setSlides: (fn: (slides: SlideModel[]) => SlideModel[]) => void;
  setCurrentSlideIndex: (fn: (i: number) => number) => void;
  slides: SlideModel[];
}

export default function useAppendSlide({
  setSlides,
  setCurrentSlideIndex,
  slides,
}: AppendSlideParams) {
  useCopilotAction({
    name: "appendSlide",
    description:
      "Add a slide after all the existing slides. Call this function multiple times to add multiple slides.",
    parameters: [
      {
        name: "content",
        description:
          "The content of the slide. MUST consist of a title, then an empty newline, then a few bullet points. Always between 1-3 bullet points - no more, no less.",
      },
      {
        name: "backgroundImageDescription",
        description:
          "What to display in the background of the slide. For example, 'dog', 'house', etc.",
      },
      {
        name: "spokenNarration",
        description:
          "The text to read while presenting the slide. Should be distinct from the slide's content, " +
          "and can include additional context, references, etc. Will be read aloud as-is. " +
          "Should be a few sentences long, clear, and smooth to read." +
          "DO NOT include meta-commentary, such as 'in this slide', 'we explore', etc.",
      },
    ],

    handler: async ({ content, backgroundImageDescription, spokenNarration }) => {
      const newSlide: SlideModel = {
        content,
        backgroundImageDescription,
        spokenNarration,
      };

      setSlides((slides) => [...slides, newSlide]);
      setCurrentSlideIndex((i) => slides.length);
    },
    render: (props) => {
      return (
        <SlidePreview
          {...props.args}
          done={props.status === "complete"}
          inProgressLabel="Adding slide..."
          doneLabel="Slide added."
        />
      );
    },
  });
}
