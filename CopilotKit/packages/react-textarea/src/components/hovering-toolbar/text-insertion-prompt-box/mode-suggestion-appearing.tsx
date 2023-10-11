import useAutosizeTextArea from "../../../hooks/misc/use-autosize-textarea";
import { MinimalChatGPTMessage } from "../../../types";
import {
  EditingEditorState,
  Generator_InsertionOrEditingSuggestion,
} from "../../../types/base/autosuggestions-bare-function";
import { ChipWithIcon } from "../../manual-ui/chip-with-icon";
import {
  FilePointer,
  SourceSearchBox,
} from "../../source-search-box/source-search-box";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import React, { useEffect, useRef, useState } from "react";

import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import { streamPromiseFlatten } from "../../../lib/stream-promise-flatten";

export type SuggestionState = {
  editorState: EditingEditorState;
};

export interface SuggestionAppearingProps {
  state: SuggestionState;
  performInsertion: (insertedText: string) => void;
  insertionOrEditingFunction: Generator_InsertionOrEditingSuggestion;
}

export const SuggestionAppearing: React.FC<SuggestionAppearingProps> = ({
  performInsertion,
  state,
  insertionOrEditingFunction,
}) => {
  const [editSuggestion, setEditSuggestion] = useState<string>("");
  const [suggestionIsLoading, setSuggestionIsLoading] =
    useState<boolean>(false);

  const [adjustmentPrompt, setAdjustmentPrompt] = useState<string>("");

  const [generatingSuggestion, setGeneratingSuggestion] =
    useState<ReadableStream<string> | null>(null);

  const adjustmentTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionTextAreaRef = useRef<HTMLTextAreaElement>(null);

  const [filePointers, setFilePointers] = useState<FilePointer[]>([]);

  useAutosizeTextArea(suggestionTextAreaRef, editSuggestion || "");
  useAutosizeTextArea(adjustmentTextAreaRef, adjustmentPrompt || "");

  // initially focus on the adjustment prompt text area
  useEffect(() => {
    adjustmentTextAreaRef.current?.focus();
  }, []);

  useEffect(() => {
    // if no generating suggestion, do nothing
    if (!generatingSuggestion) {
      return;
    }

    // Check if the stream is already locked (i.e. already reading from it)
    if (generatingSuggestion.locked) {
      return;
    }

    // reset the edit suggestion
    setEditSuggestion("");

    // read the generating suggestion stream and continuously update the edit suggestion
    const reader = generatingSuggestion.getReader();

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
  }, [generatingSuggestion]);

  const begingGeneratingAdjustment = async () => {
    // don't generate text if the prompt is empty
    if (!adjustmentPrompt.trim()) {
      return;
    }

    // if the current edit suggestion is not empty, then use it as the selected text instead of the editor state's selected text
    let editorState = state.editorState;
    if (editSuggestion !== "") {
      editorState.selectedText = editSuggestion;
    }

    const adjustmentSuggestionTextStreamPromise = insertionOrEditingFunction(
      editorState,
      adjustmentPrompt,
      new AbortController().signal
    );
    const adjustmentSuggestionTextStream = streamPromiseFlatten(
      adjustmentSuggestionTextStreamPromise
    );

    setGeneratingSuggestion(adjustmentSuggestionTextStream);
  };

  const isLoading = suggestionIsLoading;

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
              begingGeneratingAdjustment();
            }
          }}
          placeholder={'"make it more formal", "be more specific", ...'}
          style={{ minHeight: "3rem" }}
          className="w-full bg-slate-100 h-auto h-min-14 text-sm p-2 rounded-md resize-none overflow-visible focus:outline-none focus:ring-0 focus:border-non pr-[3rem]"
          rows={1}
        />
        <button
          onClick={begingGeneratingAdjustment}
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
          {isLoading && (
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
        disabled={suggestionIsLoading}
        onChange={(e) => setEditSuggestion(e.target.value)}
        className="w-full text-base p-2 border border-gray-300 rounded-md resize-none bg-green-50"
        style={{ overflow: "auto", maxHeight: "10em" }}
      />
    </>
  );

  const SubmitComponent = (
    <div className="flex w-full gap-4 justify-start">
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
      {filePointers.length > 0 && (
        <IncludedFilesPreview
          includedFiles={filePointers}
          setIncludedFiles={setFilePointers}
        />
      )}
      {sourceSearchWord !== undefined && (
        <SourceSearchBox
          searchTerm={sourceSearchWord}
          recentFiles={mockFiles}
          onSelectedFile={(filePointer) => {
            setAdjustmentPrompt(
              adjustmentPrompt.replace(new RegExp(`@${sourceSearchWord}$`), "")
            );
            setFilePointers((prev) => [...prev, filePointer]);

            // focus back on the adjustment prompt, and move the cursor to the end
            adjustmentTextAreaRef.current?.focus();
          }}
        />
      )}
      {generatingSuggestion ? SuggestionComponent : null}
      {generatingSuggestion ? SubmitComponent : null}
    </div>
  );
};

interface IncludedFilesPreviewProps {
  includedFiles: FilePointer[];
  setIncludedFiles: React.Dispatch<React.SetStateAction<FilePointer[]>>;
}

export const IncludedFilesPreview: React.FC<IncludedFilesPreviewProps> = ({
  includedFiles,
  setIncludedFiles,
}) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {includedFiles.map((filePointer, index) => {
          return (
            <FileChipPreview
              key={`file-${filePointer.sourceApplication}.${filePointer.name}`}
              filePointer={filePointer}
              onDelete={() => {
                setIncludedFiles((prev) =>
                  prev.filter((fp) => fp !== filePointer)
                );
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export interface FileChipPreviewProp {
  filePointer: FilePointer;
  onDelete: () => void;
}

export const FileChipPreview: React.FC<FileChipPreviewProp> = ({
  filePointer,
  onDelete,
}) => {
  return (
    <Chip
      label={filePointer.name}
      onDelete={onDelete}
      avatar={
        <Avatar sx={{ backgroundColor: "transparent" }}>
          <IconForFilePointer
            filePointer={filePointer}
            className="w-4 h-4 object-contain"
          />
        </Avatar>
      }
    />
  );
};

export function IconForFilePointer({
  filePointer,
  className,
}: {
  filePointer: FilePointer;
  className: string;
}): JSX.Element {
  if (filePointer.sourceApplication === "Salesforce") {
    return <IconSalesforce className={className} />;
  } else {
    return <IconSalesforce className={className} />;
  }
}

function IconSalesforce({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 273 191"
      {...props}
    >
      <title>{"Salesforce.com logo"}</title>
      <defs>
        <path id="a" d="M.06.5h272v190H.06z" />
      </defs>
      <g fillRule="evenodd">
        <mask id="b" fill="#fff">
          <use xlinkHref="#a" />
        </mask>
        <path
          fill="#00A1E0"
          d="M113 21.3c8.78-9.14 21-14.8 34.5-14.8 18 0 33.6 10 42 24.9a58 58 0 0 1 23.7-5.05c32.4 0 58.7 26.5 58.7 59.2s-26.3 59.2-58.7 59.2c-3.96 0-7.82-.398-11.6-1.15-7.35 13.1-21.4 22-37.4 22a42.7 42.7 0 0 1-18.8-4.32c-7.45 17.5-24.8 29.8-45 29.8-21.1 0-39-13.3-45.9-32a45.1 45.1 0 0 1-9.34.972c-25.1 0-45.4-20.6-45.4-45.9 0-17 9.14-31.8 22.7-39.8a52.6 52.6 0 0 1-4.35-21c0-29.2 23.7-52.8 52.9-52.8 17.1 0 32.4 8.15 42 20.8"
          mask="url(#b)"
        />
        <path
          fill="#FFFFFE"
          d="M39.4 99.3c-.171.446.061.539.116.618.511.37 1.03.638 1.55.939 2.78 1.47 5.4 1.9 8.14 1.9 5.58 0 9.05-2.97 9.05-7.75v-.094c0-4.42-3.92-6.03-7.58-7.18l-.479-.155c-2.77-.898-5.16-1.68-5.16-3.5v-.093c0-1.56 1.4-2.71 3.56-2.71 2.4 0 5.26.799 7.09 1.81 0 0 .542.35.739-.173.107-.283 1.04-2.78 1.14-3.06.106-.293-.08-.514-.271-.628-2.1-1.28-5-2.15-8-2.15l-.557.002c-5.11 0-8.68 3.09-8.68 7.51v.095c0 4.66 3.94 6.18 7.62 7.23l.592.184c2.68.824 5 1.54 5 3.42v.094c0 1.73-1.51 3.02-3.93 3.02-.941 0-3.94-.016-7.19-2.07-.393-.229-.617-.394-.92-.579-.16-.097-.56-.272-.734.252l-1.1 3.06m81.7 0c-.171.446.061.539.118.618.509.37 1.03.638 1.55.939 2.78 1.47 5.4 1.9 8.14 1.9 5.58 0 9.05-2.97 9.05-7.75v-.094c0-4.42-3.91-6.03-7.58-7.18l-.479-.155c-2.77-.898-5.16-1.68-5.16-3.5v-.093c0-1.56 1.4-2.71 3.56-2.71 2.4 0 5.25.799 7.09 1.81 0 0 .542.35.74-.173.106-.283 1.04-2.78 1.13-3.06.107-.293-.08-.514-.27-.628-2.1-1.28-5-2.15-8-2.15l-.558.002c-5.11 0-8.68 3.09-8.68 7.51v.095c0 4.66 3.94 6.18 7.62 7.23l.591.184c2.69.824 5 1.54 5 3.42v.094c0 1.73-1.51 3.02-3.93 3.02-.943 0-3.95-.016-7.19-2.07-.393-.229-.623-.387-.921-.579-.101-.064-.572-.248-.733.252l-1.1 3.06m55.8-9.36c0 2.7-.504 4.83-1.49 6.34-.984 1.49-2.47 2.22-4.54 2.22s-3.55-.724-4.52-2.21c-.977-1.5-1.47-3.64-1.47-6.34 0-2.7.496-4.82 1.47-6.31.968-1.48 2.44-2.19 4.52-2.19s3.56.717 4.54 2.19c.992 1.49 1.49 3.61 1.49 6.31m4.66-5.01c-.459-1.55-1.17-2.91-2.12-4.05a10.151 10.151 0 0 0-3.58-2.72c-1.42-.665-3.1-1-5-1s-3.57.337-5 1c-1.42.664-2.63 1.58-3.58 2.72-.948 1.14-1.66 2.5-2.12 4.05-.455 1.54-.686 3.22-.686 5.01 0 1.79.231 3.47.686 5.01.457 1.55 1.17 2.91 2.12 4.05.951 1.14 2.16 2.05 3.58 2.7 1.43.648 3.11.978 5 .978 1.89 0 3.57-.33 4.99-.978 1.42-.648 2.63-1.56 3.58-2.7.949-1.14 1.66-2.5 2.12-4.05.454-1.54.685-3.22.685-5.01 0-1.78-.231-3.47-.685-5.01m38.3 12.8c-.153-.453-.595-.282-.595-.282-.677.259-1.4.499-2.17.619-.776.122-1.64.183-2.55.183-2.25 0-4.05-.671-5.33-2-1.29-1.33-2.01-3.47-2-6.37.007-2.64.645-4.62 1.79-6.14 1.13-1.5 2.87-2.28 5.17-2.28 1.92 0 3.39.223 4.93.705 0 0 .365.159.54-.322.409-1.13.711-1.94 1.15-3.18.124-.355-.18-.505-.291-.548-.604-.236-2.03-.623-3.11-.786-1.01-.154-2.18-.234-3.5-.234-1.96 0-3.7.335-5.19.999-1.49.663-2.75 1.58-3.75 2.72-1 1.14-1.76 2.5-2.27 4.05-.505 1.54-.76 3.23-.76 5.02 0 3.86 1.04 6.99 3.1 9.28 2.06 2.3 5.16 3.46 9.2 3.46 2.39 0 4.84-.483 6.6-1.18 0 0 .336-.162.19-.554l-1.15-3.16m8.15-10.4c.223-1.5.634-2.75 1.28-3.72.967-1.48 2.44-2.29 4.51-2.29s3.44.814 4.42 2.29c.65.975.934 2.27 1.04 3.72l-11.3-.002zm15.7-3.3c-.397-1.49-1.38-3-2.02-3.69-1.02-1.09-2.01-1.86-3-2.28a11.5 11.5 0 0 0-4.52-.917c-1.97 0-3.76.333-5.21 1.01-1.45.682-2.67 1.61-3.63 2.77-.959 1.16-1.68 2.53-2.14 4.1-.46 1.55-.692 3.25-.692 5.03 0 1.82.241 3.51.715 5.04.479 1.54 1.25 2.89 2.29 4.01 1.04 1.13 2.37 2.01 3.97 2.63 1.59.615 3.52.934 5.73.927 4.56-.015 6.96-1.03 7.94-1.58.175-.098.34-.267.134-.754l-1.03-2.89c-.158-.431-.594-.275-.594-.275-1.13.422-2.73 1.18-6.48 1.17-2.45-.004-4.26-.727-5.4-1.86-1.16-1.16-1.74-2.85-1.83-5.25l15.8.012s.416-.004.459-.41c.017-.168.541-3.24-.471-6.79zm-142 3.3c.223-1.5.635-2.75 1.28-3.72.968-1.48 2.44-2.29 4.51-2.29s3.44.814 4.42 2.29c.649.975.933 2.27 1.04 3.72l-11.3-.002zm15.7-3.3c-.396-1.49-1.38-3-2.02-3.69-1.02-1.09-2.01-1.86-3-2.28a11.5 11.5 0 0 0-4.52-.917c-1.97 0-3.76.333-5.21 1.01-1.45.682-2.67 1.61-3.63 2.77-.957 1.16-1.68 2.53-2.14 4.1-.459 1.55-.69 3.25-.69 5.03 0 1.82.239 3.51.716 5.04.478 1.54 1.25 2.89 2.28 4.01 1.04 1.13 2.37 2.01 3.97 2.63 1.59.615 3.51.934 5.73.927 4.56-.015 6.96-1.03 7.94-1.58.174-.098.34-.267.133-.754l-1.03-2.89c-.159-.431-.595-.275-.595-.275-1.13.422-2.73 1.18-6.48 1.17-2.44-.004-4.26-.727-5.4-1.86-1.16-1.16-1.74-2.85-1.83-5.25l15.8.012s.416-.004.459-.41c.017-.168.541-3.24-.472-6.79zm-49.8 13.6c-.619-.494-.705-.615-.91-.936-.313-.483-.473-1.17-.473-2.05 0-1.38.46-2.38 1.41-3.05-.01.002 1.36-1.18 4.58-1.14a32 32 0 0 1 4.28.365v7.17h.002s-2 .431-4.26.567c-3.21.193-4.63-.924-4.62-.921zm6.28-11.1c-.64-.047-1.47-.07-2.46-.07-1.35 0-2.66.168-3.88.498-1.23.332-2.34.846-3.29 1.53a7.63 7.63 0 0 0-2.29 2.6c-.559 1.04-.844 2.26-.844 3.64 0 1.4.243 2.61.723 3.6a6.54 6.54 0 0 0 2.06 2.47c.877.638 1.96 1.11 3.21 1.39 1.24.283 2.64.426 4.18.426 1.62 0 3.23-.136 4.79-.399a95.1 95.1 0 0 0 3.97-.772c.526-.121 1.11-.28 1.11-.28.39-.099.36-.516.36-.516l-.009-14.4c0-3.16-.844-5.51-2.51-6.96-1.66-1.45-4.09-2.18-7.24-2.18-1.18 0-3.09.16-4.23.389 0 0-3.44.668-4.86 1.78 0 0-.312.192-.142.627l1.12 3c.139.389.518.256.518.256s.119-.047.259-.13c3.03-1.65 6.87-1.6 6.87-1.6 1.7 0 3.02.345 3.9 1.02.861.661 1.3 1.66 1.3 3.76v.667c-1.35-.196-2.6-.309-2.6-.309zm127-8.13a.428.428 0 0 0-.237-.568c-.269-.102-1.61-.385-2.64-.449-1.98-.124-3.08.21-4.07.654-.978.441-2.06 1.15-2.66 1.97l-.002-1.92c0-.264-.187-.477-.453-.477h-4.04c-.262 0-.452.213-.452.477v23.5a.48.48 0 0 0 .479.479h4.14a.479.479 0 0 0 .478-.479v-11.8c0-1.58.174-3.15.521-4.14.342-.979.807-1.76 1.38-2.32a4.79 4.79 0 0 1 1.95-1.17 7.68 7.68 0 0 1 2.12-.298c.825 0 1.73.212 1.73.212.304.034.473-.152.576-.426.271-.721 1.04-2.88 1.19-3.31"
        />
        <path
          fill="#FFFFFE"
          d="M162.201 67.548a13.258 13.258 0 0 0-1.559-.37 12.217 12.217 0 0 0-2.144-.166c-2.853 0-5.102.806-6.681 2.398-1.568 1.58-2.635 3.987-3.17 7.154l-.193 1.069h-3.581s-.437-.018-.529.459l-.588 3.28c-.041.314.094.51.514.508h3.486l-3.537 19.743c-.277 1.59-.594 2.898-.945 3.889-.346.978-.684 1.711-1.1 2.243-.403.515-.785.894-1.444 1.115-.544.183-1.17.267-1.856.267-.382 0-.89-.064-1.265-.139-.375-.074-.57-.158-.851-.276 0 0-.409-.156-.57.254-.131.335-1.06 2.89-1.17 3.206-.112.312.045.558.243.629.464.166.809.272 1.441.421.878.207 1.618.22 2.311.22 1.452 0 2.775-.204 3.872-.6 1.104-.399 2.065-1.094 2.915-2.035.919-1.015 1.497-2.078 2.05-3.528.547-1.437 1.013-3.221 1.386-5.3l3.554-20.109h5.196s.438.016.529-.459l.588-3.28c.041-.314-.093-.51-.515-.508h-5.043c.025-.114.254-1.888.833-3.558.247-.713.712-1.288 1.106-1.683a3.273 3.273 0 0 1 1.321-.822 5.48 5.48 0 0 1 1.693-.244c.475 0 .941.057 1.296.131.489.104.679.159.807.197.514.157.583.005.684-.244l1.206-3.312c.124-.356-.178-.506-.29-.55m-70.474 34.117c0 .264-.188.479-.452.479h-4.183c-.265 0-.453-.215-.453-.479V67.997c0-.263.188-.476.453-.476h4.183c.264 0 .452.213.452.476v33.668"
        />
      </g>
    </svg>
  );
}

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
