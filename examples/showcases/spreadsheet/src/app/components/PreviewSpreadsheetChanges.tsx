import { CheckCircleIcon } from "@heroicons/react/20/solid";
import { SpreadsheetRow } from "../types";
import { useState } from "react";
import Spreadsheet from "react-spreadsheet";

export interface PreviewSpreadsheetChanges {
  preCommitTitle: string;
  postCommitTitle: string;
  newRows: SpreadsheetRow[];
  commit: (rows: SpreadsheetRow[]) => void;
}

export function PreviewSpreadsheetChanges(props: PreviewSpreadsheetChanges) {
  const [changesCommitted, setChangesCommitted] = useState(false);

  const commitChangesButton = () => {
    return (
      <button
        className="inline-flex items-center gap-x-2 rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        onClick={() => {
          props.commit(props.newRows);
          setChangesCommitted(true);
        }}
      >
        {props.preCommitTitle}
      </button>
    );
  };

  const changesCommittedButtonPlaceholder = () => {
    return (
      <button
        className=" inline-flex items-center gap-x-2 rounded-md bg-gray-100 px-3.5 py-2.5 text-sm font-semibold text-green-600 shadow-sm cursor-not-allowed"
        disabled
      >
        {props.postCommitTitle}
        <CheckCircleIcon className="-mr-0.5 h-5 w-5" aria-hidden="true" />
      </button>
    );
  };

  return (
    <div className="flex flex-col">
      <Spreadsheet data={props.newRows} />

      <div className="mt-5">
        {changesCommitted
          ? changesCommittedButtonPlaceholder()
          : commitChangesButton()}
      </div>
    </div>
  );
}
