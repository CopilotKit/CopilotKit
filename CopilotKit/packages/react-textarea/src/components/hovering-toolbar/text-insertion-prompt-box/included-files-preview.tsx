import { DocumentPointer } from "@copilotkit/react-core";
import Avatar from "@mui/material/Avatar/Avatar.js";
import Chip from "@mui/material/Chip/Chip.js";
import React from "react";
import { Label } from "../../ui/label";

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
        {includedFiles.map((filePointer, _index) => {
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

export const FileChipPreview = ({ filePointer, onDelete }: FileChipPreviewProps) => {
  return (
    <Chip
      label={filePointer.name}
      onDelete={onDelete}
      avatar={
        <Avatar
          src={filePointer.iconImageUri}
          alt={filePointer.sourceApplication}
          sx={{ backgroundColor: "transparent" }}
        ></Avatar>
      }
    />
  );
};
