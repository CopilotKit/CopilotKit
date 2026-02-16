"use client";
import useUpdateSlide from "../../actions/useUpdateSlide";
import { SlideModel } from "../../types";

export interface SlideProps {
  slide: SlideModel;
  partialUpdateSlide: (partialSlide: Partial<SlideModel>) => void;
}

export const Slide = (props: SlideProps) => {
  const backgroundImage = `url("${props.slide.backgroundImageUrl}")`;

  /**
   * This action allows the Copilot to update the current slide.
   */
  useUpdateSlide({ partialUpdateSlide: props.partialUpdateSlide });

  return (
    <div className="flex h-full w-full flex-row bg-white">
      <div className="flex h-full flex-grow flex-col" style={{ flex: "2" }}>
        <SlideContent
          content={props.slide.content}
          onChange={(newContent) => {
            props.partialUpdateSlide({ content: newContent });
          }}
        />
        <SlideSpeakerNotes
          spokenNarration={props.slide.spokenNarration}
          onChange={(newSpokenNarration) => {
            props.partialUpdateSlide({ spokenNarration: newSpokenNarration });
          }}
        />
      </div>
      <SlideImage backgroundImage={backgroundImage} />
    </div>
  );
};

function SlideImage({ backgroundImage }: { backgroundImage: string }) {
  return (
    <div
      className="h-full flex-grow bg-slate-200"
      style={{
        flex: "1",
        backgroundImage,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}

interface SpeakerNotesProps {
  spokenNarration: string;
  onChange: (newSpokenNarration: string) => void;
}

function SlideSpeakerNotes({ spokenNarration, onChange }: SpeakerNotesProps) {
  return (
    <div className="relative flex h-20 flex-col bg-gray-200">
      <textarea
        className="h-full w-full bg-transparent p-2 text-base"
        style={{
          border: "none",
          outline: "none",
          lineHeight: "1.5",
          resize: "none",
        }}
        placeholder="Speaker notes..."
        value={spokenNarration}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </div>
  );
}

interface SlideContentProps {
  content: string;
  onChange: (newContent: string) => void;
}

function SlideContent({ content, onChange }: SlideContentProps) {
  return (
    <textarea
      className="line-clamp-6 flex w-full flex-1 items-center p-4 px-10 font-bold text-gray-800"
      style={{
        border: "none",
        outline: "none",
        resize: "none",
        fontSize: "2vw",
      }}
      value={content}
      placeholder="Slide content..."
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
}
