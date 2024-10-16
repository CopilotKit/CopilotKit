"use client";

import { useCoAgent, useCopilotChat } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { MessageRole, TextMessage } from "@copilotkit/runtime-client-gql";

interface TranslateAgentState {
  input: string;
  translations?: {
    translation_es: string;
    translation_fr: string;
    translation_de: string;
  };
}

export function Translator() {
  const {
    state: translateAgentState,
    setState: setTranslateAgentState,
    run: runTranslateAgent,
  } = useCoAgent<TranslateAgentState>({
    name: "translate_agent",
    initialState: { input: "Hello World" },
  });

  const { isLoading } = useCopilotChat();

  console.log("state", translateAgentState);

  const handleTranslate = () => {
    runTranslateAgent(() => new TextMessage({ role: MessageRole.User, content: "Translate to all languages" }));
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <div>
        <input
          type="text"
          placeholder="Text to translate..."
          value={translateAgentState.input}
          onChange={(e) =>
            setTranslateAgentState({
              ...translateAgentState,
              input: e.target.value,
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleTranslate();
            }
          }}
          className="w-full p-2 border border-gray-300 rounded"
        />
        <button
          disabled={!translateAgentState.input || isLoading}
          onClick={handleTranslate}
          className="mt-2 w-full p-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          {isLoading ? "Translating..." : "Translate"}
        </button>
      </div>

      {translateAgentState.translations && (
        <div className="mt-8">
          <div>Spanish: {translateAgentState.translations.translation_es}</div>
          <div>French: {translateAgentState.translations.translation_fr}</div>
          <div>German: {translateAgentState.translations.translation_de}</div>
        </div>
      )}

      <CopilotPopup defaultOpen={true} />
    </div>
  );
}
