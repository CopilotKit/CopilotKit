import React, { useCallback, useState } from "react";
import {
  State_SuggestionAppearing,
  SuggestionAppearing,
} from "./mode-suggestion-appearing";
import { PreSuggestion, State_PreSuggestion } from "./mode-pre-suggestion";

export type Generator_InsertionSuggestion = (
  editorState: InsertionEditorState,
  prompt: string
) => Promise<string>;

export interface InsertionEditorState {
  textBeforeCursor: string;
  textAfterCursor: string;
}

type InsertionPromptState = State_PreSuggestion | State_SuggestionAppearing;

export interface Props {
  editorState: InsertionEditorState;
  insertionSuggestion: Generator_InsertionSuggestion;
  performInsertion: (insertedText: string) => void;
  closeWindow: () => void;
}

export const HoveringInsertionPromptBox: React.FC<Props> = (props) => {
  const [insertionPrompt, setInsertionPrompt] = useState<string>("");
  const [mode, setMode] = useState<InsertionPromptState>({
    type: "pre-suggestion",
  });

  const handleGeneratedText = useCallback(
    (generatedText: string) => {
      setMode({
        type: "suggestion-appearing",
        initialSuggestion: {
          adjustmentPrompt: insertionPrompt,
          suggestion: generatedText,
        },
      });
    },
    [setMode, insertionPrompt]
  );

  const goBack = () => {
    setMode({ type: "pre-suggestion" });
  };

  return (
    <div className="flex flex-col justify-center items-center space-y-4 rounded-md border w-96 shadow-lg p-4 border-gray- bg-white">
      {mode.type === "pre-suggestion" ? (
        <PreSuggestion
          {...props}
          insertionPrompt={insertionPrompt}
          setInsertionPrompt={setInsertionPrompt}
          onGeneratedText={handleGeneratedText}
        />
      ) : (
        <SuggestionAppearing {...props} state={mode} goBack={goBack} />
      )}
    </div>
  );
};
