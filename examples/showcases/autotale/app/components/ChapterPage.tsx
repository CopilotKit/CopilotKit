import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useStory } from "../lib/StoryProvider";
import { ImageIcon, LoaderCircleIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useCoagent, useCoagentAction } from "@copilotkit/react-core";

export const gradient =
  "rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0) 10%, rgba(0, 0, 0, 0) 90%, rgba(0, 0, 0, 0.1) 100%";
export const commonPageClass = "h-full overflow-hidden border border-stone-300";

export function ChapterContentPage({ chapterIndex }: { chapterIndex: number }) {
  const { chapters, setChapters } = useStory();
  const { state: story, setState: setStory } = useCoagent({
    name: "childrensBookAgent",
  });
  const [content, setContent] = useState(chapters[chapterIndex]?.content || "");

  const chapterContent = story?.story?.[chapterIndex]?.content;

  useEffect(() => {
    if (chapterContent) {
      setContent(chapterContent);
      // setStory({
      //   ...story,
      //   story: {
      //     ...story.story,
      //     [chapterIndex]: { ...story.story[chapterIndex], content },
      //   },
      // });
    }
  }, [chapterContent]);
  // useEffect(() => {
  //   setContent(chapters[chapterIndex]?.content || "");
  // }, [chapters[chapterIndex]?.content]);

  const MAX_CONTENT_LENGTH = 200;
  // const saveDisabled = !hasChanges || content.length > MAX_CONTENT_LENGTH;

  const handleSaveChanges = () => {
    const newChapters = chapters.map((chapter, index) => {
      if (index === chapterIndex) {
        return { ...chapter, content };
      }
      return chapter;
    });
    setChapters(newChapters);
    setStory({
      ...story,
      story: {
        ...story.story,
        [chapterIndex]: { ...story.story[chapterIndex], content },
      },
    });
  };

  return (
    <div className={cn(commonPageClass, "rounded-l-lg bg-white")}>
      <div
        className="h-full font-story flex flex-col py-8 px-8 gap-y-8 items-center w-full pointer-events-auto"
        style={{ background: `linear-gradient(to left, ${gradient})` }}
      >
        <div className="text-xl font-medium whitespace-pre-wrap">
          Chapter {chapterIndex + 1}
        </div>
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
            value={content}
            placeholder="Your chapter goes here..."
            onChange={(e) => setContent(e.target.value)}
          ></textarea>

          {/* {hasChanges && (
            <Button
              disabled={saveDisabled}
              className={cn(
                "w-full h-10 text-center",
                saveDisabled && "opacity-10"
              )}
              onClick={handleSaveChanges}
            >
              Save changes ({content.length}/{MAX_CONTENT_LENGTH})
            </Button>
          )} */}
        </div>
      </div>
    </div>
  );
}

export function ChapterImagePage({ chapterIndex }: { chapterIndex: number }) {
  const { chapters, setChapters } = useStory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(
    chapters[chapterIndex]?.imageUrl || null
  );
  const [isLoading, setIsLoading] = useState(false);

  const imageDescription = chapters[chapterIndex]?.imageDescription;

  useEffect(() => {
    if (imageDescription && !imageUrl && !isLoading) {
      (async () => {
        setIsLoading(true);
        try {
          console.log(
            `For chapter ${chapterIndex}, image description is ${imageDescription}`
          );
          const response = await fetch("/api/gen-chapter-image", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              description: imageDescription,
            }),
          });
          const data = await response.json();
          if (data.imageUrl) {
            setImageUrl(data.imageUrl);
          }
        } catch (error) {
          console.error("Error generating chapter image:", error);
        } finally {
          setIsLoading(false);
        }
      })();
    }
  }, [imageDescription, imageUrl, isLoading]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setChapters(
          chapters.map((chapter, index) => {
            if (index === chapterIndex) {
              return { ...chapter, imageUrl: base64String };
            }
            return chapter;
          })
        );
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={cn(commonPageClass, "rounded-r-lg font-story")}>
      <div
        className="h-full w-full"
        style={{
          backgroundImage: imageUrl ? `url(${imageUrl})` : "none",
          backgroundSize: imageUrl ? "cover" : "none",
          backgroundColor: imageUrl ? "transparent" : "white",
        }}
      >
        <div
          style={{ background: `linear-gradient(to left, ${gradient})` }}
          className="h-full w-full flex items-center justify-center pointer-events-auto"
        >
          {isLoading && (
            <span className="flex flex-col items-center text-sm">
              <LoaderCircleIcon className="w-14 h-14 text-stone-500 animate-spin" />
              <div className="mt-5">Generating Image...</div>
            </span>
          )}

          {!imageUrl && !isLoading ? (
            <div className="flex flex-col gap-y-4">
              Upload an image for this chapter
              <Button onClick={() => fileInputRef.current?.click()}>
                Upload
              </Button>
            </div>
          ) : (
            !isLoading && (
              <div className="w-full h-full flex p-2 justify-end font-sans">
                {/* <Button
                  className="opacity-40 hover:opacity-100"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }}
                >
                  <ImageIcon className="w-4 h-4 mr-2" />
                  <span>Upload Image</span>
                </Button> */}
              </div>
            )
          )}

          <Input
            id="image"
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
            ref={fileInputRef}
          />
        </div>
      </div>
    </div>
  );
}
