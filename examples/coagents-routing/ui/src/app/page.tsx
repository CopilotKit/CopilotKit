"use client";
import {
  CopilotKit,
  useCoAgent,
  useCoAgentStateRender,
  useCopilotChat,
  useCopilotContext,
  useCopilotMessagesContext,
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
import { MessageRole } from "@copilotkit/runtime-client-gql";

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
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4 flex justify-center">
          <ResetButton />
        </div>
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4">
          <CurrentAgentSession />
        </div>
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4">
          <Joke />
        </div>
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4">
          <Email />
        </div>
        <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 mt-4">
          <PirateMode />
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

function ResetButton() {
  const { reset } = useCopilotChat();
  return (
    <button
      className="px-6 py-3 border-2 border-gray-300 bg-white text-gray-800 rounded-lg shadow-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition duration-300 ease-in-out"
      onClick={() => reset()}
    >
      Reset Everything
    </button>
  );
}

function CurrentAgentSession() {
  const { agentSession } = useCopilotContext();
  const { stop, setState } = useCoAgent({
    name: agentSession?.agentName ?? "pirate_agent",
  });
  const { stopGeneration } = useCopilotChat();
  const { messages, setMessages } = useCopilotMessagesContext();
  const { model } = useModelSelectorContext();

  function stopAgent() {
    stopGeneration();
    stop();
    setState({ model });
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.isTextMessage() && message.role !== MessageRole.User) {
        messages.pop();
      } else {
        break;
      }
    }
    setMessages(messages);
  }

  return (
    <div style={{ fontSize: "0.875rem", textAlign: "center" }}>
      Current agent session: {agentSession?.agentName ?? "None"}
      {agentSession?.agentName && (
        <button
          onClick={stopAgent}
          className="ml-4 px-6 py-3 border-2 border-gray-300 bg-white text-gray-800 rounded-lg shadow-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition duration-300 ease-in-out"
        >
          Stop current agent
        </button>
      )}
    </div>
  );
}

function PirateMode() {
  const { model } = useModelSelectorContext();
  useCopilotChatSuggestions({
    instructions: "Suggest to talk to a pirate about piratey things",
    maxSuggestions: 1,
  });
  const { running } = useCoAgent({
    name: "pirate_agent",
    initialState: {
      model,
    },
  });

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
