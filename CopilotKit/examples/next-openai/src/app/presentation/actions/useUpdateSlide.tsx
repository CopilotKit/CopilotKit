import { useCopilotAction } from "@copilotkit/react-core";
import { SlideModel } from "../types";
import { SlidePreview } from "../components/misc/SlidePreview";

interface UpdateSlideParams {
  partialUpdateSlide: (partialSlide: Partial<SlideModel>) => void;
}

export default function useUpdateSlide({ partialUpdateSlide }: UpdateSlideParams) {
  useCopilotAction({
    name: "updateSlide",
    description: "Update the current slide.",
    parameters: [
      {
        name: "content",
        description: "The content of the slide. Should generally consist of a few bullet points.",
      },
      {
        name: "backgroundImageDescription",
        description:
          "What to display in the background of the slide. For example, 'dog', 'house', etc.",
      },
      {
        name: "spokenNarration",
        description:
          "The spoken narration for the slide. This is what the user will hear when the slide is shown.",
      },
    ],
    handler: async ({ content, backgroundImageDescription, spokenNarration }) => {
      partialUpdateSlide({
        content,
        backgroundImageDescription,
        spokenNarration,
      });
    },
    render: (props) => {
      return (
        <SlidePreview
          {...props.args}
          done={props.status === "complete"}
          inProgressLabel="Updating slide..."
          doneLabel="Slide updated."
        />
      );
    },
  });
}
