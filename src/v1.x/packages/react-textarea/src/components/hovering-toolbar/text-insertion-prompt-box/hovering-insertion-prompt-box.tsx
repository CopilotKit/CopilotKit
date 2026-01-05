import { HoveringInsertionPromptBoxCore } from "./hovering-insertion-prompt-box-core";
import {
  EditingEditorState,
  InsertionEditorApiConfig,
} from "../../../types/base/autosuggestions-bare-function";

export interface Props {
  editorState: EditingEditorState;
  apiConfig: InsertionEditorApiConfig;
  performInsertion: (insertedText: string) => void;
  contextCategories: string[];
}

export const HoveringInsertionPromptBox = (props: Props) => {
  return (
    <div
      className="flex flex-col justify-center items-center space-y-4 rounded-md border shadow-lg p-4 border-gray- bg-white"
      style={{ width: "35rem" }}
    >
      <HoveringInsertionPromptBoxCore
        state={{
          editorState: props.editorState,
        }}
        insertionOrEditingFunction={props.apiConfig.insertionOrEditingFunction}
        performInsertion={props.performInsertion}
        contextCategories={props.contextCategories}
      />
    </div>
  );
};
