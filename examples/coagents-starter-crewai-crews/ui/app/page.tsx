"use client";

import { useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { Streamdown } from "streamdown";

export default function Home() {
  return (
    <>
      <MainContent />
      <CopilotPopup
        defaultOpen={true}
        labels={{
          title: "Popup Assistant",
          initial: "Need any help?",
        }}
        clickOutsideToClose={false}
      />
    </>
  );
}

function MainContent() {
  const { state, setState } = useCoAgent({
    name: "research_crew",
    initialState: {
      inputs: {
        topic: "",
        current_year: "2025",
      },
      outputs: "Report will appear here",
    },
  });

  useCopilotAction({
    name: "research_crew",
    parameters: [
      {
        name: "topic",
      },
      {
        name: "current_year",
      },
    ],
    render({ args, status }) {
      return (
        <div className="m-4 p-4 bg-gray-100 rounded shadow">
          <h1 className="text-center text-sm">
            Researching {args.topic} in {args.current_year}{" "}
            {status == "complete" ? "✅" : "⏳"}
          </h1>
        </div>
      );
    },
  });

  return (
    <div className="h-screen w-screen flex justify-center items-start text-2xl">
      <form className="space-y-4 max-w-lg w-full mx-auto">
        <div>
          <label
            htmlFor="currentYear"
            className="block text-sm font-medium text-gray-700"
          >
            Current Year
          </label>
          <input
            type="text"
            id="currentYear"
            name="currentYear"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={state.inputs.current_year}
            onChange={(e) =>
              setState({
                ...state,
                inputs: { ...state.inputs, current_year: e.target.value },
              })
            }
          />
        </div>
        <div>
          <label
            htmlFor="topic"
            className="block text-sm font-medium text-gray-700"
          >
            Topic
          </label>
          <input
            type="text"
            id="topic"
            name="topic"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={state.inputs.topic}
            onChange={(e) =>
              setState({
                ...state,
                inputs: { ...state.inputs, topic: e.target.value },
              })
            }
          />
        </div>
        <div>
          <label
            htmlFor="result"
            className="block text-sm font-medium text-gray-700"
          >
            Result
          </label>
          <div
            id="result"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm bg-white mb-10"
          >
            <Streamdown>{state.outputs}</Streamdown>
          </div>
        </div>
      </form>
    </div>
  );
}
