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
import { BottomButton } from "./bottom-button";

export type InsertTextFunctionRaw = (
  editorState: InsertionEditorState,
  prompt: string
) => Promise<string>;

export interface InsertionEditorState {
  textBeforeCursor: string;
  textAfterCursor: string;
}

export interface Props {
  editorState: InsertionEditorState;
  insertionFunction: InsertTextFunctionRaw;
  performInsertion: (insertedText: string) => void;
  closeWindow: () => void;
}

export const HoveringInsertionPromptBox: React.FC<Props> = ({
  editorState,
  insertionFunction,
  performInsertion,
  closeWindow,
}) => {
  const [editPrompt, setEditPrompt] = useState("");
  const [editSuggestion, setEditSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const promptTextAreaRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(promptTextAreaRef, editPrompt);

  const suggestionTextAreaRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(suggestionTextAreaRef, editSuggestion || "");

  const generateText = async () => {
    setLoading(true);
    const editedText = await insertionFunction(editorState, editPrompt);
    setEditSuggestion(editedText);
    setLoading(false);
  };

  return (
    <div className="flex flex-col justify-center items-center space-y-4 rounded-md border w-96 shadow-lg p-4 border-gray- bg-white">
      <div className="flex justify-center items-start">
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
        {editSuggestion !== null && (
          <button
            className="h-8 right-0 p-3 flex items-center"
            onClick={generateText}
          >
            <i className="material-icons">refresh</i>
          </button>
        )}
      </div>

      {editSuggestion !== null && (
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
      )}
      <BottomButton
        loading={loading}
        editSuggestion={editSuggestion}
        generateText={generateText}
        performInsertion={performInsertion}
      />
    </div>
  );
};
