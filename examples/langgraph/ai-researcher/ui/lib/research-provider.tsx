import { createContext, useContext, useState, ReactNode, useEffect } from "react";

type ResearchContextType = {
  researchQuery: string;
  setResearchQuery: (query: string) => void;
  researchInput: string;
  setResearchInput: (input: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  researchResult: ResearchResult | null;
  setResearchResult: (result: ResearchResult) => void;
};

type ResearchResult = {
  answer: string;
  sources: string[];
}

const ResearchContext = createContext<ResearchContextType | undefined>(undefined);

export const ResearchProvider = ({ children }: { children: ReactNode }) => {
  const [researchQuery, setResearchQuery] = useState<string>("");
  const [researchInput, setResearchInput] = useState<string>("");
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!researchQuery) {
      setResearchResult(null);
      setResearchInput("");
    }
  }, [researchQuery, researchResult]);

  return (
    <ResearchContext.Provider
      value={{
        researchQuery,
        setResearchQuery,
        researchInput,
        setResearchInput,
        isLoading,
        setIsLoading,
        researchResult,
        setResearchResult,
      }}
    >
      {children}
    </ResearchContext.Provider>
  );
};

export const useResearchContext = () => {
  const context = useContext(ResearchContext);
  if (context === undefined) {
    throw new Error("useResearchContext must be used within a ResearchProvider");
  }
  return context;
};