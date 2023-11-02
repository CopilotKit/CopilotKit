import { DocumentPointer } from "@copilotkit/react-core";
import { Label } from "../../ui/label";
import React from "react";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";

export interface IncludedFilesPreviewProps {
  includedFiles: DocumentPointer[];
  setIncludedFiles: React.Dispatch<React.SetStateAction<DocumentPointer[]>>;
}

export const IncludedFilesPreview: React.FC<IncludedFilesPreviewProps> = ({
  includedFiles,
  setIncludedFiles,
}) => {
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
  filePointer: DocumentPointer;
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
      avatar={<Avatar sx={{ backgroundColor: "transparent" }}></Avatar>}
    />
  );
};
