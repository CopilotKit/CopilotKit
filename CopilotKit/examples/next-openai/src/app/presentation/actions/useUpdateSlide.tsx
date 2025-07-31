import { useCopilotAction, useFrontendTool } from "@copilotkit/react-core";
import { SlideModel } from "../types";
import { SlidePreview } from "../components/misc/SlidePreview";
import z from "zod";

interface UpdateSlideParams {
  partialUpdateSlide: (partialSlide: Partial<SlideModel>) => void;
}

export default function useUpdateSlide({ partialUpdateSlide }: UpdateSlideParams) {
  useFrontendTool({
    name: "updateSlide",
    description: "Update the current slide.",
    parameters: z.object({
      content: z
        .string()
        .describe("The content of the slide. Should generally consist of a few bullet points."),
      backgroundImageUrl: z
        .string()
        .describe(
          "The url of the background image for the slide. Use the getImageUrl tool to retrieve a URL for a topic.",
        ),
      spokenNarration: z
        .string()
        .describe(
          "The spoken narration for the slide. This is what the user will hear when the slide is shown.",
        ),
    }),
    handler: async ({ content, backgroundImageUrl, spokenNarration }) => {
      partialUpdateSlide({
        content,
        backgroundImageUrl,
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
