import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import React, { useRef, useState } from "react";
import {
  InsertionEditorState,
  InsertTextFunctionRaw,
} from "./hovering-insertion-prompt-box";

export type State_PreSuggestion = {
  type: "pre-suggestion";
};

export interface PreSuggestionProps {
  editorState: InsertionEditorState;
  insertionFunction: InsertTextFunctionRaw;
  onGeneratedText: (generatedText: string) => void;
}
export const PreSuggestion: React.FC<PreSuggestionProps> = ({
  editorState,
  insertionFunction,
  onGeneratedText,
}) => {
  const [editPrompt, setEditPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  const promptTextAreaRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(promptTextAreaRef, editPrompt);

  const generateText = async () => {
    setLoading(true);
    const editedText = await insertionFunction(editorState, editPrompt);
    setLoading(false);
    onGeneratedText(editedText);
  };

  return (
    <div className="flex flex-col justify-center items-start">
      <textarea
        ref={promptTextAreaRef}
        value={editPrompt}
        onChange={(e) => setEditPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            setEditPrompt(editPrompt + "\n");
          } else if (e.key === "Enter") {
            e.preventDefault();
            generateText();
          }
        }}
        placeholder="Describe the text you'd like to insert..."
        className="w-full bg-slate-200 h-auto text-sm p-2 rounded-md resize-none overflow-visible focus:outline-none focus:ring-0 focus:border-none"
        rows={1}
      />
      <button
        disabled={loading}
        onClick={generateText}
        className="w-full py-2 px-4 rounded-md text-white bg-blue-500 hover:bg-blue-700"
      >
        {loading ? "Loading..." : "Generate Text"}
      </button>
    </div>
  );
};
