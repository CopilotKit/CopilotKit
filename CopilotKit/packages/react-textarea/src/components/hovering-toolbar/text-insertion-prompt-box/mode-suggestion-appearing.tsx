import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import { MinimalChatGPTMessage } from "../../../types";
import {
  EditingEditorState,
  Generator_InsertionOrEditingSuggestion,
} from "../../../types/base/autosuggestions-bare-function";
import {
  FilePointer,
  SourceSearchBox,
} from "../../source-search-box/source-search-box";
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
  editorState: EditingEditorState;
};

export interface SuggestionAppearingProps {
  state: State_SuggestionAppearing;
  performInsertion: (insertedText: string) => void;
  goBack: () => void;
  insertionOrEditingFunction: Generator_InsertionOrEditingSuggestion;
  onGeneratedText: (generatedText: ReadableStream<string>) => void;
}

export const SuggestionAppearing: React.FC<SuggestionAppearingProps> = ({
  performInsertion,
  state,
  goBack,
  insertionOrEditingFunction,
  onGeneratedText,
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

    setAdjustmentLoading(true);
    // use insertionOrEditingFunction
    const adjustmentSuggestionTextStream = await insertionOrEditingFunction(
      {
        ...state.initialSuggestion.editorState,
        selectedText: editSuggestion,
      },
      adjustmentPrompt,
      new AbortController().signal
    );
    setAdjustmentLoading(false);
    onGeneratedText(adjustmentSuggestionTextStream);
  };

  const showLoading = suggestionIsLoading || adjustmentLoading;

  const AdjustmentPromptComponent = (
    <>
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
    </>
  );

  const SuggestionComponent = (
    <>
      <div className="flex justify-between items-end w-full">
        <Label className="mt-4">Suggested:</Label>
        <div className="ml-auto">
          {showLoading && (
            <div className="flex justify-center items-center">
              <div
                className="inline-block h-4 w-4 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
                role="status"
              >
                <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
                  Loading...
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      <textarea
        ref={suggestionTextAreaRef}
        value={editSuggestion}
        disabled={adjustmentLoading}
        onChange={(e) => setEditSuggestion(e.target.value)}
        className="w-full text-base p-2 border border-gray-300 rounded-md resize-none bg-green-200"
        style={{ overflow: "auto", maxHeight: "10em" }}
      />
    </>
  );

  const SubmitComponent = (
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
  );

  // show source search if the last word in the adjustment prompt BEGINS with an @
  const sourceSearchCandidate = adjustmentPrompt.split(" ").pop();
  // if the candidate is @someCandidate, then 'someCandidate', otherwise undefined
  const sourceSearchWord = sourceSearchCandidate?.startsWith("@")
    ? sourceSearchCandidate.slice(1)
    : undefined;

  return (
    <div className="w-full flex flex-col items-start relative gap-2">
      {AdjustmentPromptComponent}
      {sourceSearchWord !== undefined && (
        <SourceSearchBox
          searchTerm={sourceSearchWord}
          recentFiles={mockFiles}
        />
      )}
      {SuggestionComponent}
      {SubmitComponent}
    </div>
  );
};

const mockFiles: FilePointer[] = [
  {
    name: "prospecting call transcript",
    sourceApplication: "Salesforce",
    getContents: async () => {
      return "some contents";
    },
  },
  {
    name: "customer feedback",
    sourceApplication: "Zendesk",
    getContents: async () => {
      return "some contents";
    },
  },
  {
    name: "product specifications",
    sourceApplication: "Google Docs",
    getContents: async () => {
      return "some contents";
    },
  },
  {
    name: "meeting minutes",
    sourceApplication: "Microsoft Teams",
    getContents: async () => {
      return "some contents";
    },
  },
  {
    name: "project plan",
    sourceApplication: "Trello",
    getContents: async () => {
      return "some contents";
    },
  },
  {
    name: "code review comments",
    sourceApplication: "Github",
    getContents: async () => {
      return "some contents";
    },
  },
];
