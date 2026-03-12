import { cn } from "@/lib/utils";
import { gradient, commonPageClass } from "./ChapterPage";
import { useStory } from "../lib/StoryProvider";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCoagent, useCoagentAction } from "@copilotkit/react-core";
import { BookOpenIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";

function StoryChapterProgress({ chapterIndex }: { chapterIndex: number }) {
  const { getPageFlip } = useStory();
  const { state: story } = useCoagent({ name: "childrensBookAgent" });
  const chapter = useMemo(
    () => story.story?.[chapterIndex],
    [story.story, chapterIndex]
  );
  const hasImageDescription = useMemo(
    () => chapter?.image_description,
    [chapter?.image_description]
  );

  const goToChapter = (idx: number) => {
    const pf = getPageFlip();
    const pageNum = 2 + idx * 2;
    pf.flip(pageNum, "bottom");
  };

  return (
    <div className="px-2 py-2 [&:not(:last-child)]:border-b text-xs flex justify-between items-center gap-x-2">
      <div className="flex-1">Chapter {chapterIndex + 1}</div>
      <>
        {hasImageDescription ? (
          <>
            <BookOpenIcon
              className="w-3 h-3 text-stone-500 cursor-pointer"
              onClick={() => goToChapter(chapterIndex)}
            >
              Go
            </BookOpenIcon>
            {/* <CheckIcon className="w-3 h-3 text-emerald-600" /> */}
          </>
        ) : (
          <LoaderCircleIcon className="animate-spin w-3 h-3 text-stone-500" />
        )}
      </>
    </div>
  );
}

function StoryNodeProgress() {
  const { state: story } = useCoagent({ name: "childrensBookAgent" });

  const isDoneGenerating = useMemo(() => {
    return story.story?.every((chapter: any) => chapter.image_description);
  }, [story.story]);

  return (
    <div className="border-t border-b py-4">
      <div className="w-full border rounded-md text-xs overflow-hidden flex justify-center flex-col shadow-lg">
        <div className="bg-stone-900 text-white p-2">
          <div className="flex">
            {isDoneGenerating ? (
              <>
                <div className="flex-1">Story written!</div>
                <div>
                  <CheckIcon className="w-3 h-3 text-white" />
                </div>
              </>
            ) : (
              <>
                <div className="flex-1">Generating story...</div>
                <div>
                  <LoaderCircleIcon className="animate-spin w-3 h-3 text-white" />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col">
          <StoryChapterProgress chapterIndex={0} />
          <StoryChapterProgress chapterIndex={1} />
          <StoryChapterProgress chapterIndex={2} />
          <StoryChapterProgress chapterIndex={3} />
          <StoryChapterProgress chapterIndex={4} />
        </div>
      </div>
    </div>
  );
}

export function OutlinePage() {
  const { outline, setOutline } = useStory();
  const [textareaOutline, setTextareaOutline] = useState(outline);
  const { state: story, setState: setStory } = useCoagent({
    name: "childrensBookAgent",
  });

  useCoagentAction({
    name: "childrensBookAgent",
    nodeName: "story_node",
    render: () => <StoryNodeProgress />,
  });

  useEffect(() => {
    if (story?.outline) {
      setOutline(story.outline);
      setTextareaOutline(story.outline);
    }
  }, [story?.outline, setOutline]);

  const MAX_OUTLINE_LENGTH = 400;
  const hasChanges = textareaOutline !== outline;
  const saveDisabled =
    !hasChanges || textareaOutline.length > MAX_OUTLINE_LENGTH;

  const handleSaveChanges = () => {
    setOutline(textareaOutline);
    setStory({ ...story, outline: textareaOutline });
  };

  return (
    <div className={cn(commonPageClass, "rounded-l-lg bg-white")}>
      <div
        className="h-full font-story flex flex-col py-8 px-8 gap-y-8 items-center w-full pointer-events-auto"
        style={{ background: `linear-gradient(to left, ${gradient})` }}
      >
        <div className="text-xl font-medium whitespace-pre-wrap">Outline</div>
        <div className="w-full flex-1 flex flex-col text-lg">
          <textarea
            onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => {
              if (
                e.target instanceof HTMLTextAreaElement &&
                !e.target.matches(":focus")
              ) {
                e.target.focus();
                e.target.setSelectionRange(
                  e.target.value.length,
                  e.target.value.length
                );
              }
            }}
            className="w-full h-full bg-transparent resize-none focus:outline-none"
            value={textareaOutline}
            placeholder="Your story outline goes here..."
            onChange={(e) => setTextareaOutline(e.target.value)}
          ></textarea>

          {hasChanges && (
            <Button
              disabled={saveDisabled}
              className={cn(
                "w-full h-10 text-center",
                saveDisabled && "opacity-10"
              )}
              onClick={handleSaveChanges}
            >
              Save changes ({textareaOutline.length}/{MAX_OUTLINE_LENGTH})
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
