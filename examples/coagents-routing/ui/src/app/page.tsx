"use client";
import {
  CopilotKit,
  useCoAgent,
  useCoAgentStateRender,
} from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useCopilotChatSuggestions,
} from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import {
  ModelSelectorProvider,
  useModelSelectorContext,
} from "./lib/model-selector-provider";
import { ModelSelector } from "./components/ModelSelector";
import { MessageRole, TextMessage } from "@copilotkit/runtime-client-gql";

export default function ModelSelectorWrapper() {
  return (
    <ModelSelectorProvider>
      <Home />
      <ModelSelector />
    </ModelSelectorProvider>
  );
}

function Home() {
  const { lgcDeploymentUrl } = useModelSelectorContext();

  return (
    <CopilotKit
      runtimeUrl={`/api/copilotkit?lgcDeploymentUrl=${lgcDeploymentUrl ?? ""}`}
    >
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6">
          <Joke />
        </div>
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4">
          <Email />
        </div>
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4">
          <PirateMode />
        </div>
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4 flex justify-center items-center">
          <RunPirateMode />
        </div>
        <CopilotSidebar
          defaultOpen={true}
          clickOutsideToClose={false}
          className="mt-4"
        />
      </div>
    </CopilotKit>
  );
}

function usePirateAgent() {
  const { model } = useModelSelectorContext();
  return useCoAgent({
    name: "pirate_agent",
    initialState: {
      model,
    },
  });
}

function PirateMode() {
  useCopilotChatSuggestions({
    instructions: "Suggest to talk to a pirate about piratey things",
    maxSuggestions: 1,
  });
  const { running } = usePirateAgent();

  if (running) {
    return (
      <div
        data-test-id="container-pirate-mode-on"
        style={{ fontSize: "0.875rem", textAlign: "center" }}
      >
        Pirate mode is on
      </div>
    );
  } else {
    return (
      <div
        data-test-id="container-pirate-mode-off"
        style={{ fontSize: "0.875rem", textAlign: "center" }}
      >
        Pirate mode is off
      </div>
    );
  }
}

function RunPirateMode() {
  const { run } = usePirateAgent();
  return (
    <button
      onClick={() =>
        run(
          () =>
            new TextMessage({
              content: "Run pirate mode",
              role: MessageRole.User,
            })
        )
      }
      className="bg-white text-black border border-gray-300 rounded px-4 py-2 shadow hover:bg-gray-100"
    >
      Run Pirate Mode
    </button>
  );
}

function Joke() {
  const { model } = useModelSelectorContext();
  useCopilotChatSuggestions({
    instructions: "Suggest to make a joke about a specific subject",
    maxSuggestions: 1,
  });
  const { state } = useCoAgent({
    name: "joke_agent",
    initialState: {
      model,
      joke: "",
    },
  });

  useCoAgentStateRender({
    name: "joke_agent",
    render: ({ state, nodeName }) => {
      return <div>Generating joke: {state.joke}</div>;
    },
  });

  if (!state.joke) {
    return (
      <div
        data-test-id="container-joke-empty"
        style={{ fontSize: "0.875rem", textAlign: "center" }}
      >
        No joke generated yet
      </div>
    );
  } else {
    return <div data-test-id="container-joke-nonempty">Joke: {state.joke}</div>;
  }
}

function Email() {
  const { model } = useModelSelectorContext();
  useCopilotChatSuggestions({
    instructions: "Suggest to write an email to a famous person",
    maxSuggestions: 1,
  });
  const { state } = useCoAgent({
    name: "email_agent",
    initialState: {
      model,
      email: "",
    },
  });

  useCoAgentStateRender({
    name: "email_agent",
    render: ({ state, nodeName }) => {
      return <div>Generating email: {state.email}</div>;
    },
  });

  if (!state.email) {
    return (
      <div
        data-test-id="container-email-empty"
        style={{ fontSize: "0.875rem", textAlign: "center" }}
      >
        No email generated yet
      </div>
    );
  } else {
    return (
      <div data-test-id="container-email-nonempty">Email: {state.email}</div>
    );
  }
}
