import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import { MinimalChatGPTMessage } from "../../../types";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import React, { useEffect, useRef, useState } from "react";

export type State_SuggestionAppearing = {
  type: "suggestion-appearing";
  initialSuggestion: SuggestionSnapshot;
};

type SuggestionSnapshot = {
  adjustmentPrompt: string;
  generatingSuggestion: ReadableStream<string>;
};

export interface SuggestionAppearingProps {
  state: State_SuggestionAppearing;
  performInsertion: (insertedText: string) => void;
  goBack: () => void;

  // adjustmentGenerator: (
  //   editorState: InsertionEditorState,
  //   history: SuggestionSnapshot[]
  // ) => Promise<string>;
}

export const SuggestionAppearing: React.FC<SuggestionAppearingProps> = ({
  performInsertion,
  state,
  goBack,
}) => {
  const [adjustmentHistory, setAdjustmentHistory] = useState<
    SuggestionSnapshot[]
  >([state.initialSuggestion]);

  const [editSuggestion, setEditSuggestion] = useState<string>("");
  const [suggestionIsLoading, setSuggestionIsLoading] =
    useState<boolean>(false);

  const [adjustmentPrompt, setAdjustmentPrompt] = useState<string>("");
  const [adjustmentLoading, setAdjustmentLoading] = useState<boolean>(false);

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

  useEffect(() => {
    // Check if the stream is already locked
    if (state.initialSuggestion.generatingSuggestion.locked) {
      return;
    }
    // reset the edit suggestion
    setEditSuggestion("");

    // read the generating suggestion stream and continuously update the edit suggestion
    const reader = state.initialSuggestion.generatingSuggestion.getReader();

    const read = async () => {
      setSuggestionIsLoading(true);
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        setEditSuggestion((prev) => {
          const newSuggestion = prev + value;
          // Scroll to the bottom of the textarea. We call this here to make sure scroll-to-bottom is synchronous with the state update.
          if (suggestionTextAreaRef.current) {
            suggestionTextAreaRef.current.scrollTop =
              suggestionTextAreaRef.current.scrollHeight;
          }
          return newSuggestion;
        });
      }

      setSuggestionIsLoading(false);
    };
    read();

    return () => {
      const releaseLockIfNotClosed = async () => {
        try {
          await reader.closed;
        } catch {
          reader.releaseLock();
        }
      };

      releaseLockIfNotClosed();
    };
  }, [state]);

  const generateAdjustment = async () => {
    // don't generate text if the prompt is empty
    if (!adjustmentPrompt.trim()) {
      return;
    }

    // modify the history
  };

  return (
    <div className="w-full flex flex-col items-start relative gap-2">
      <Label className="">Describe adjustments to the suggested text:</Label>
      <div className="relative w-full flex items-center">
        <textarea
          disabled={suggestionIsLoading}
          ref={adjustmentTextAreaRef}
          value={adjustmentPrompt}
          onChange={(e) => setAdjustmentPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              setAdjustmentPrompt(adjustmentPrompt + "\n");
            } else if (e.key === "Enter") {
              e.preventDefault();
              generateAdjustment();
            }
          }}
          placeholder={'"make it more formal", "be more specific", ...'}
          style={{ minHeight: "3rem" }}
          className="w-full bg-slate-100 h-auto h-min-14 text-sm p-2 rounded-md resize-none overflow-visible focus:outline-none focus:ring-0 focus:border-non pr-[3rem]"
          rows={1}
        />
        <button
          onClick={generateAdjustment}
          className="absolute right-2 bg-blue-500 text-white w-8 h-8 rounded-full flex items-center justify-center"
        >
          <i className="material-icons">arrow_forward</i>
        </button>
      </div>
      <Label className=" mt-4">Suggested:</Label>
      <textarea
        ref={suggestionTextAreaRef}
        value={editSuggestion}
        disabled={adjustmentLoading}
        onChange={(e) => setEditSuggestion(e.target.value)}
        className="w-full text-base p-2 border border-gray-300 rounded-md resize-none bg-green-200"
        style={{ overflow: "auto", maxHeight: "8em" }}
      />

      <div className="flex w-full gap-4 justify-start">
        <Button
          className=" bg-gray-300"
          onClick={() => {
            goBack();
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
