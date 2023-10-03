import React, { useCallback, useState } from "react";
import {
  State_SuggestionAppearing,
  SuggestionAppearing,
} from "./mode-suggestion-appearing";
import { PreSuggestion, State_PreSuggestion } from "./mode-pre-suggestion";
import {
  EditingEditorState,
  InsertionEditorApiConfig,
} from "../../../types/base/autosuggestions-bare-function";

type InsertionPromptState = State_PreSuggestion | State_SuggestionAppearing;

export interface Props {
  editorState: EditingEditorState;
  apiConfig: InsertionEditorApiConfig;
  performInsertion: (insertedText: string) => void;
  closeWindow: () => void;
}

export const HoveringInsertionPromptBox: React.FC<Props> = (props) => {
  const [insertionPrompt, setInsertionPrompt] = useState<string>("");
  const [mode, setMode] = useState<InsertionPromptState>({
    type: "pre-suggestion",
  });

  const handleGeneratedText = useCallback(
    (generatingText: ReadableStream<string>) => {
      setMode({
        type: "suggestion-appearing",
        initialSuggestion: {
          editorState: props.editorState,
          adjustmentPrompt: insertionPrompt,
          generatingSuggestion: generatingText,
        },
      });
    },
    [setMode, insertionPrompt]
  );

  const goBack = () => {
    setMode({ type: "pre-suggestion" });
  };

  return (
    <div className="flex flex-col justify-center items-center space-y-4 rounded-md border shadow-lg p-4 border-gray- bg-white" style={{width: "30rem"}}>
      {mode.type === "pre-suggestion" ? (
        <PreSuggestion
          {...props}
          insertionOrEditingFunction={
            props.apiConfig.insertionOrEditingFunction
          }
          insertionOrEditingPrompt={insertionPrompt}
          setInsertionOrEditingPrompt={setInsertionPrompt}
          onGeneratedText={handleGeneratedText}
        />
      ) : (
        <SuggestionAppearing
          {...props}
          state={mode}
          goBack={goBack}
          insertionOrEditingFunction={
            props.apiConfig.insertionOrEditingFunction
          }
          onGeneratedText={handleGeneratedText}
        />
      )}
    </div>
  );
};
