import { ResearchHelperComponent } from "@/components/research-helper";
import { useCoAgent } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

export default function ResearchCanvas() {
  const { state, setState } = useCoAgent({
    name: "research_agent",
    initialState: {
      research_question: "",
      resources: [],
      report: "",
      logs: [],
    },
  });
  return (
    <div className="flex h-screen border">
      <div className="w-[400px] h-full">
        <CopilotChat
          className="h-full border-r border-gray-200"
          onSubmitMessage={async (message) => {
            // clear the logs before starting the new research
            setState({ ...state, logs: [] });
            await new Promise((resolve) => setTimeout(resolve, 30));
          }}
        />
      </div>
      <div className="flex-1">
        <ResearchHelperComponent />
      </div>
    </div>
  );
}
