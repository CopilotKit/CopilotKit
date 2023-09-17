import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import React, { useEffect, useRef, useState } from "react";
import {
  EditingEditorState,
  Generator_InsertionSuggestion,
} from "../../../types/base/autosuggestions-bare-function";

export type State_PreSuggestion = {
  type: "pre-suggestion";
};

export interface PreSuggestionProps {
  editorState: EditingEditorState;
  insertionSuggestion: Generator_InsertionSuggestion;
  onGeneratedText: (generatedText: ReadableStream<string>) => void;

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

  const generateText = async (abortSignal?: AbortSignal) => {
    // don't generate text if the prompt is empty
    if (!insertionPrompt.trim()) {
      return;
    }

    setLoading(true);
    const insertionSuggestionTextStream = await insertionSuggestion(
      editorState,
      insertionPrompt,
      abortSignal || new AbortController().signal
    );
    onGeneratedText(insertionSuggestionTextStream);

    setLoading(false);
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
        onClick={() => generateText()}
        className="w-full py-2 px-4 rounded-md text-white bg-blue-500 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        {loading ? "Loading..." : "Generate Text"}
      </button>
    </div>
  );
};
