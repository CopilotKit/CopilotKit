import { useCopilotReadable, useCoagent } from "@copilotkit/react-core";
import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { useDebounceCallback, useDebounceValue } from "usehooks-ts";

export type Chapter = {
  content: string;
  imageUrl: string | null;
  imageDescription: string | null;
};

export type Character = {
  name: string;
  appearance: string;
  traits: string[];
};

type StoryContextType = {
  chapters: Chapter[];
  setChapters: (chapters: Chapter[]) => void;
  outline: string;
  setOutline: (outline: string) => void;
  characters: Character[];
  setCharacters: (characters: Character[]) => void;
  currentChapterIdx: number | null;
  setCurrentChapterIdx: (currentChapter: number | null) => void;
  bookRef: React.RefObject<any>;
  getPageFlip: () => any;
};

const StoryContext = createContext<StoryContextType | undefined>(undefined);

export const StoryProvider = ({ children }: { children: ReactNode }) => {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const debouncedSetChapters = useDebounceCallback(setChapters, 1000);
  const [outline, setOutline] = useState<string>("Write your outline here...");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number | null>(
    null
  );
  const { state: story } = useCoagent({ name: "childrensBookAgent" });
  const bookRef = useRef<any>(null);

  useEffect(() => {
    if (story?.story) {
      const chapters: Chapter[] = story.story.map((c: any, idx: number) => {
        const chapter: Chapter = {
          content: c.content,
          imageDescription: c.image_description || null,
          imageUrl: null,
        };

        return chapter;
      });

      // console.log("chapters", chapters)
      debouncedSetChapters(chapters);
    }
  }, [story?.story, debouncedSetChapters]);

  const getPageFlip = () => {
    if (bookRef.current) {
      return bookRef.current.pageFlip();
    }
  };

  return (
    <StoryContext.Provider
      value={{
        bookRef,
        getPageFlip,
        chapters,
        setChapters,
        outline,
        setOutline,
        characters,
        setCharacters,
        currentChapterIdx,
        setCurrentChapterIdx,
      }}
    >
      {children}
    </StoryContext.Provider>
  );
};

export const useStory = () => {
  const context = useContext(StoryContext);
  if (context === undefined) {
    throw new Error("useStory must be used within a StoryProvider");
  }
  return context;
};
