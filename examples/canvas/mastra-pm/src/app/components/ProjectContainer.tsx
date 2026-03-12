import { AgentState } from "@/lib/state";
import { ProjectHeader } from "./ProjectHeader";
import { KanbanBoard } from "./KanbanBoard";
import { TeamSection } from "./TeamSection";

interface ProjectContainerProps {
  state: AgentState;
}

export function ProjectContainer({ state }: ProjectContainerProps) {
  return (
    <div className="bg-white/20 backdrop-blur-md rounded-3xl shadow-2xl max-w-7xl w-full h-full flex flex-col">
      <ProjectHeader name={state?.projectName} description={state?.projectDescription} />
      <TeamSection state={state} />
      <KanbanBoard state={state} />
    </div>
  );
} 