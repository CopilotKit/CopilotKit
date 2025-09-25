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
        description: "The content of the slide. Should generally consist of a few bullet points.",
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
    handler: async ({ title, content, backgroundImageDescription, spokenNarration }) => {
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
        className="w-full relative bg-slate-200"
        style={{
          height: `calc(100vh - ${heightOfSpeakerNotes}px)`,
        }}
      >
        <div className="h-1/3 flex items-center justify-center text-5xl text-white p-10 text-center z-10">
          <textarea
            className="mt-16 text-7xl bg-white text-gray-400 p-4 text-center font-bold uppercase italic line-clamp-2 flex items-center"
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

        <div className="h-2/3 flex">
          <textarea
            className="w-1/2 text-3xl text-black font-medium p-10 resize-none bg-transparent m-12 rounded-xl"
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
            className="w-1/2 z-10 rounded-xl m-12 mr-24"
            style={{
              backgroundImage,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        </div>
      </div>

      <textarea
        className=" w-9/12 h-full bg-transparent text-5xl p-10 resize-none bg-gray-500 pr-36"
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
