import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import React, { useEffect, useRef, useState } from "react";

export type State_SuggestionAppearing = {
  type: "suggestion-appearing";
  suggestion: string;
};

interface SuggestionAppearingProps {
  state: State_SuggestionAppearing;
  performInsertion: (insertedText: string) => void;
}

export const SuggestionAppearing: React.FC<SuggestionAppearingProps> = ({
  performInsertion,
  state,
}) => {
  const [editSuggestion, setEditSuggestion] = useState<string>(
    state.suggestion
  );
  const [adjustmentPrompt, setAdjustmentPrompt] = useState<string>("");

  const suggestionTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const adjustmentTextAreaRef = useRef<HTMLTextAreaElement>(null);

  useAutosizeTextArea(suggestionTextAreaRef, editSuggestion || "");
  useAutosizeTextArea(adjustmentTextAreaRef, adjustmentPrompt || "");

  // initially focus on the end of the suggestion text area
  useEffect(() => {
    suggestionTextAreaRef.current?.focus();
    suggestionTextAreaRef.current?.setSelectionRange(
      editSuggestion.length,
      editSuggestion.length
    );
  }, []);

  return (
    <div className="w-full flex flex-col items-start relative gap-2">
      <Label className="">Describe adjustments to the suggested text:</Label>
      <textarea
        ref={adjustmentTextAreaRef}
        value={adjustmentPrompt}
        onChange={(e) => setAdjustmentPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            setAdjustmentPrompt(adjustmentPrompt + "\n");
          } else if (e.key === "Enter") {
            e.preventDefault();
          }
        }}
        placeholder={'"make it more formal", "be more specific", ...'}
        className="w-full bg-slate-200 h-auto text-sm p-2 rounded-md resize-none overflow-visible focus:outline-none focus:ring-0 focus:border-none"
        rows={1}
      />

      <Label className=" mt-4">Suggested:</Label>
      <textarea
        ref={suggestionTextAreaRef}
        value={editSuggestion}
        onChange={(e) => setEditSuggestion(e.target.value)}
        className="w-full text-base p-2 border border-gray-300 rounded-md resize-none bg-green-200"
        style={{ overflow: "auto", maxHeight: "8em" }}
      />

      <div className="flex w-full gap-4 justify-start">
        <Button
          className=" bg-gray-300"
          onClick={() => {
            performInsertion(editSuggestion);
          }}
        >
          <i className="material-icons">arrow_back</i> Back
        </Button>

        <Button
          className=" bg-green-700 text-white"
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
