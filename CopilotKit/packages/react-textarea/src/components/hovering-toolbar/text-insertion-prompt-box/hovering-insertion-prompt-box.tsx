import React, { useCallback, useState } from "react";
import { SuggestionAppearing } from "./mode-suggestion-appearing";
import {
  EditingEditorState,
  InsertionEditorApiConfig,
} from "../../../types/base/autosuggestions-bare-function";

export interface Props {
  editorState: EditingEditorState;
  apiConfig: InsertionEditorApiConfig;
  performInsertion: (insertedText: string) => void;
  closeWindow: () => void;
}

export const HoveringInsertionPromptBox: React.FC<Props> = (props) => {
  return (
    <div
      className="flex flex-col justify-center items-center space-y-4 rounded-md border shadow-lg p-4 border-gray- bg-white"
      style={{ width: "35rem" }}
    >
      <SuggestionAppearing
        state={{
          editorState: props.editorState,
        }}
        performInsertion={props.performInsertion}
        insertionOrEditingFunction={props.apiConfig.insertionOrEditingFunction}
      />
    </div>
  );
};
