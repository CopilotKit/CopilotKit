import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import React, { useEffect, useRef, useState } from "react";
import {
  InsertionEditorState,
  Generator_InsertionSuggestion,
} from "./hovering-insertion-prompt-box";

export type State_PreSuggestion = {
  type: "pre-suggestion";
};

export interface PreSuggestionProps {
  editorState: InsertionEditorState;
  insertionSuggestion: Generator_InsertionSuggestion;
  onGeneratedText: (generatedText: string) => void;

  insertionPrompt: string;
  setInsertionPrompt: (value: string) => void;
}

export const PreSuggestion: React.FC<PreSuggestionProps> = ({
  editorState,
  insertionSuggestion,
  onGeneratedText,
  insertionPrompt,
  setInsertionPrompt,
}) => {
  const [loading, setLoading] = useState(false);

  const promptTextAreaRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(promptTextAreaRef, insertionPrompt);

  // initially focus on the prompt text area
  useEffect(() => {
    promptTextAreaRef.current?.focus();
  }, []);

  const generateText = async () => {
    // don't generate text if the prompt is empty
    if (!insertionPrompt.trim()) {
      return;
    }

    setLoading(true);
    const insertionSuggestionText = await insertionSuggestion(
      editorState,
      insertionPrompt
    );
    setLoading(false);
    onGeneratedText(insertionSuggestionText);
  };

  return (
    <div className="flex flex-col justify-center items-start gap-2">
      <textarea
        ref={promptTextAreaRef}
        value={insertionPrompt}
        onChange={(e) => setInsertionPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            setInsertionPrompt(insertionPrompt + "\n");
          } else if (e.key === "Enter") {
            e.preventDefault();
            generateText();
          }
        }}
        placeholder="Describe the text you'd like to insert..."
        className="w-full bg-slate-100 h-auto text-sm p-2 rounded-md resize-none overflow-visible focus:outline-none focus:ring-0 focus:border-none"
        rows={1}
      />
      <button
        disabled={loading || !insertionPrompt.trim()}
        onClick={generateText}
        className="w-full py-2 px-4 rounded-md text-white bg-blue-500 hover:bg-blue-700"
      >
        {loading ? "Loading..." : "Generate Text"}
      </button>
    </div>
  );
};
