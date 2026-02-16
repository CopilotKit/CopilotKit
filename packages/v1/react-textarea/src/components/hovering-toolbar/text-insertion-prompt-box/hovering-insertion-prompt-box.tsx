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
      className="border-gray- flex flex-col items-center justify-center space-y-4 rounded-md border bg-white p-4 shadow-lg"
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
