"use client";

import HTMLFlipBook from "react-pageflip";
import { ChapterContentPage, ChapterImagePage } from "./ChapterPage";
import { Chapter, useStory } from "../lib/StoryProvider";
import { useCoagentAction, useCopilotContext } from "@copilotkit/react-core";
import { useEffect, useRef, useState } from "react";
import { OutlinePage } from "./OutlinePage";
import { CharactersPage } from "./CharactersPage";
import { Button } from "@/components/ui/button";

export function BookView() {
  const { chapters, setChapters, bookRef } = useStory();
  const [currentPageIdx, setCurrentPageIdx] = useState<number | null>(null);

  useCoagentAction({
    name: "childrensBookAgent",
    nodeName: "story_node",
    render: "Writing story...",
  });

  useCoagentAction({
    name: "childrensBookAgent",
    nodeName: "outline_node",
    handler: (props) => {
      console.log("outline_node", props);
    },
  });

  const getPageFlip = () => {
    if (bookRef.current) {
      return bookRef.current.pageFlip();
    }
  };

  const flipBookProps: Partial<React.ComponentProps<typeof HTMLFlipBook>> = {
    width: 400,
    height: 400,
    size: "stretch",
    maxShadowOpacity: 0.5,
    mobileScrollSupport: false,
    className: "shadow-lg rounded-lg bg-white pointer-events-none",
    onFlip: (e) => {
      const pageIdx = e.data;
      console.log("pageIdx", pageIdx);
      setCurrentPageIdx(pageIdx);

      if (pageIdx < 2) {
        setCurrentPageIdx(null);
      }
    },
    disableFlipByClick: true,
    showPageCorners: false,
  };

  const hardcodedComponents = [
    <div key="outline">
      <OutlinePage />
    </div>,
    <div key="characters">
      <CharactersPage />
    </div>,
  ];

  const chapterComponents: React.ReactNode[] = [];

  chapters.forEach((chapter, index) => {
    chapterComponents.push(
      <div key={`chapter_${index}_content`}>
        <ChapterContentPage chapterIndex={index} />
      </div>,
      <div key={`chapter_${index}_image`}>
        <ChapterImagePage chapterIndex={index} />
      </div>
    );
  });

  const allComponents = [...hardcodedComponents, ...chapterComponents];
  const numPages = allComponents.length;

  const handleDeleteChapter = () => {
    const pf = getPageFlip();
    const currPageIdx = pf.pages.currentPageIndex;
    const currChapterIdx = (currPageIdx - 2) / 2;
    console.log("currChapterIdx", currChapterIdx);
    pf.turnToPrevPage();
    setChapters(chapters.filter((_, index) => index !== currChapterIdx));
  };

  const handleNewChapter = () => {
    const pf = getPageFlip();

    const lastPageIdx = pf.pages.pages.length - 1;
    const nextPageIdx = lastPageIdx + 2;

    const newChapter: Chapter = {
      content: "Start writing this chapter...",
      imageUrl: null,
      imageDescription: null,
    };

    setChapters([...chapters, newChapter]);
    setTimeout(() => {
      pf.flip(nextPageIdx, "top");
    }, 100);
  };

  return (
    <>
      <div className="w-full flex justify-between font-story mb-4">
        <Button
          className="w-[200px]"
          variant="ghost"
          onClick={() => {
            const pf = getPageFlip();
            const currPage = pf.pages.currentPageIndex;
            const nextPage = currPage - 2;
            pf.flip(nextPage, "buttom");
          }}
          disabled={currentPageIdx === null}
        >
          ← Previous Page
        </Button>
        <div className="flex-1 flex gap-x-4 justify-center items-center">
          {true && <Button onClick={handleNewChapter}>+ New Chapter</Button>}
          {currentPageIdx !== null && (
            <Button onClick={handleDeleteChapter}>X Delete Chapter</Button>
          )}
        </div>
        <Button
          className="w-[200px]"
          variant="ghost"
          onClick={() => {
            const pf = getPageFlip();
            const currPage = pf.pages.currentPageIndex;
            console.log("currPage", currPage);
            console.log("pdf.pages.pages", pf.pages.pages);
            const nextPage = currPage + 2;
            pf.flip(nextPage, "top");
          }}
          disabled={currentPageIdx === numPages - 2 || !chapters.length}
        >
          Next Page →
        </Button>
      </div>
      <HTMLFlipBook ref={bookRef} {...(flipBookProps as any)}>
        {allComponents}
      </HTMLFlipBook>
    </>
  );
}
