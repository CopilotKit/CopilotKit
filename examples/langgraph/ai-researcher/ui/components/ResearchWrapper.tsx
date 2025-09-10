import { HomeView } from "./HomeView";
import { ResultsView } from "./ResultsView";
import { AnimatePresence } from "framer-motion";
import { useResearchContext } from "@/lib/research-provider";

export function ResearchWrapper() {
  const { researchQuery, setResearchInput } = useResearchContext();

  return (
    <>
      <div className="flex flex-col items-center justify-center relative z-10">
        <div className="flex-1">
          {researchQuery ? (
            <AnimatePresence
              key="results"
              onExitComplete={() => {
                setResearchInput("");
              }}
              mode="wait"
            >
              <ResultsView key="results" />
            </AnimatePresence>
          ) : (
            <AnimatePresence key="home" mode="wait">
              <HomeView key="home" />
            </AnimatePresence>
          )}
        </div>
        <footer className="text-xs p-2">
          <a
            href="https://copilotkit.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-600 font-medium hover:underline"
          >
            Powered by CopilotKit 🪁
          </a>
        </footer>
      </div>
    </>
  );
}
