import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import React, { useRef, useState } from "react";

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
