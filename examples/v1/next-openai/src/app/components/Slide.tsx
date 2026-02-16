import { useCopilotAction } from "@copilotkit/react-core";

export interface SlideModel {
  title: string;
  content: string;
  backgroundImageDescription: string;
  spokenNarration: string;
}

export interface SlideProps {
  slide: SlideModel;
  partialUpdateSlide: (partialSlide: Partial<SlideModel>) => void;
}

export const Slide = (props: SlideProps) => {
  const heightOfSpeakerNotes = 200;
  const backgroundImage =
    'url("https://source.unsplash.com/featured/?' +
    encodeURIComponent(props.slide.backgroundImageDescription) +
    '")';

  useCopilotAction({
    name: "updateSlide",
    description: "Update the current slide.",
    parameters: [
      {
        name: "title",
        type: "string",
        description: "The title of the slide. Should be a few words long.",
      },
      {
        name: "content",
        type: "string",
        description:
          "The content of the slide. Should generally consist of a few bullet points.",
      },
      {
        name: "backgroundImageDescription",
        type: "string",
        description:
          "Simple description what to display in the background of the slide. For example, 'dog', 'house', etc.",
      },
      {
        name: "spokenNarration",
        type: "string",
        description:
          "The spoken narration for the slide. This is what the user will hear when the slide is shown.",
      },
    ],
    handler: async ({
      title,
      content,
      backgroundImageDescription,
      spokenNarration,
    }) => {
      props.partialUpdateSlide({
        title,
        content,
        backgroundImageDescription,
        spokenNarration,
      });
    },
    render: "Updating slide...",
  });

  return (
    <>
      <div
        className="relative w-full bg-slate-200"
        style={{
          height: `calc(100vh - ${heightOfSpeakerNotes}px)`,
        }}
      >
        <div className="z-10 flex h-1/3 items-center justify-center p-10 text-center text-5xl text-white">
          <textarea
            className="mt-16 line-clamp-2 flex items-center bg-white p-4 text-center text-7xl font-bold uppercase italic text-gray-400"
            style={{
              border: "none",
              outline: "none",
            }}
            value={props.slide.title}
            placeholder="Title"
            onChange={(e) => {
              props.partialUpdateSlide({ title: e.target.value });
            }}
          />
        </div>

        <div className="flex h-2/3">
          <textarea
            className="m-12 w-1/2 resize-none rounded-xl bg-transparent p-10 text-3xl font-medium text-black"
            style={{
              lineHeight: "1.5",
            }}
            value={props.slide.content}
            placeholder="Body"
            onChange={(e) => {
              props.partialUpdateSlide({ content: e.target.value });
            }}
          />

          <div
            className="z-10 m-12 mr-24 w-1/2 rounded-xl"
            style={{
              backgroundImage,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        </div>
      </div>

      <textarea
        className="h-full w-9/12 resize-none bg-gray-500 bg-transparent p-10 pr-36 text-5xl"
        style={{
          height: `${heightOfSpeakerNotes}px`,
          background: "none",
          border: "none",
          outline: "none",
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
        }}
        value={props.slide.spokenNarration}
        onChange={(e) => {
          props.partialUpdateSlide({ spokenNarration: e.target.value });
        }}
      />
    </>
  );
};
