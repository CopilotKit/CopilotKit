import { DocumentPointer } from "@copilotkit/react-core";
import { Label } from "../../ui/label";
import React from "react";
import clsx from "clsx";

export interface IncludedFilesPreviewProps {
  includedFiles: DocumentPointer[];
  setIncludedFiles: React.Dispatch<React.SetStateAction<DocumentPointer[]>>;
}

export const IncludedFilesPreview = ({
  includedFiles,
  setIncludedFiles,
}: IncludedFilesPreviewProps) => {
  return (
    <div className="flex flex-col gap-2 mt-2">
      <Label className="">Included context:</Label>
      <div className="flex flex-wrap gap-2">
        {includedFiles.map((filePointer, index) => {
          return (
            <FileChipPreview
              key={`file-${filePointer.sourceApplication}.${filePointer.name}`}
              filePointer={filePointer}
              onDelete={() => {
                setIncludedFiles((prev) => prev.filter((fp) => fp !== filePointer));
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export interface FileChipPreviewProps {
  filePointer: DocumentPointer;
  onDelete: () => void;
}

function FileChipPreview({
  filePointer,
  onDelete,
}: {
  filePointer: DocumentPointer;
  onDelete: () => void;
}) {
  const CLOSE_BUTTON_COLOR = "rgba(0, 0, 0, 0.26)";
  const [color, setColor] = React.useState(CLOSE_BUTTON_COLOR);
  return (
    <div>
      <button
        className={clsx(
          "inline-flex justify-center items-center h-8 text-[0.8125rem] text-[rgba(0,0,0,0.87)]",
          "bg-[rgba(0,0,0,0.08)] rounded-full whitespace-nowrap box-border border-0 align-middle",
          "outline-none cursor-default",
        )}
      >
        <img
          className="ml-[5px] w-[24px] h-[24px] bg-transparent rounded-full"
          src={filePointer.iconImageUri}
          alt={filePointer.sourceApplication}
        />
        <span className="ml-[5px]">{filePointer.name}</span>
        <svg
          className="text-[22px] cursor-pointer mx-[5px] user-select-none w-[1em] h-[1em] inline-block fill-current flex-shrink-0"
          style={{ color }}
          viewBox="0 0 24 24"
          preserveAspectRatio="xMidYMid meet"
          onClick={onDelete}
          onMouseOver={() => setColor("rgba(0, 0, 0, 0.54)")}
          onMouseOut={() => setColor(CLOSE_BUTTON_COLOR)}
        >
          <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"></path>
        </svg>
      </button>
    </div>
  );
}
