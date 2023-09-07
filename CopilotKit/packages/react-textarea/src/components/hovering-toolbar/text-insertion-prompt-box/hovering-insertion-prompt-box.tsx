import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import React, { useEffect, useRef, useState } from "react";

export type InsertTextFunctionRaw = (
  editorState: InsertionEditorState,
  prompt: string
) => Promise<string>;

export interface InsertionEditorState {
  textBeforeCursor: string;
  textAfterCursor: string;
}

type State_PreInsertion = {
  type: "pre-insertion";
};

type State_SuggestionAppearing = {
  type: "suggestion-appearing";
  suggestion: string;
};

type InsertionPromptState = State_PreInsertion | State_SuggestionAppearing;

interface PreSuggestionProps {
  editorState: InsertionEditorState;
}

export interface Props {
  editorState: InsertionEditorState;
  insertionFunction: InsertTextFunctionRaw;
  performInsertion: (insertedText: string) => void;
  closeWindow: () => void;
}

interface PreInsertionProps {
  editorState: InsertionEditorState;
  insertionFunction: InsertTextFunctionRaw;
  onGeneratedText: (generatedText: string) => void;
}

const PreInsertion: React.FC<PreInsertionProps> = ({
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

interface SuggestionAppearingProps {
  state: State_SuggestionAppearing;
  performInsertion: (insertedText: string) => void;
}

const SuggestionAppearing: React.FC<SuggestionAppearingProps> = ({
  performInsertion,
  state,
}) => {
  const [editSuggestion, setEditSuggestion] = useState<string>(
    state.suggestion
  );

  const suggestionTextAreaRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(suggestionTextAreaRef, editSuggestion || "");

  return (
    <div className="w-full flex flex-col items-start relative gap-2">
      <Label className="">Suggested:</Label>

      <textarea
        ref={suggestionTextAreaRef}
        value={editSuggestion}
        onChange={(e) => setEditSuggestion(e.target.value)}
        className="w-full text-base p-2 border border-gray-300 rounded-md resize-none bg-green-200"
        style={{ overflow: "auto", maxHeight: "8em" }}
      />

      <div className="text-left w-full text-white">
        <Button
          className=" bg-green-700"
          onClick={() => {
            performInsertion(editSuggestion);
          }}
        >
          Insert <i className="material-icons">check</i>
        </Button>
      </div>
    </div>
  );
};

export const HoveringInsertionPromptBox: React.FC<Props> = (props) => {
  const [mode, setMode] = useState<InsertionPromptState>({
    type: "pre-insertion",
  });

  const handleGeneratedText = (newGeneratedText: string) => {
    setMode({ type: "suggestion-appearing", suggestion: newGeneratedText });
  };
  return (
    <div className="flex flex-col justify-center items-center space-y-4 rounded-md border w-96 shadow-lg p-4 border-gray- bg-white">
      {mode.type === "pre-insertion" ? (
        <PreInsertion {...props} onGeneratedText={handleGeneratedText} />
      ) : (
        <SuggestionAppearing {...props} state={mode} />
      )}
    </div>
  );
};
