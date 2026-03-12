"use client";

import TextareaAutosize from "react-textarea-autosize";
import type React from "react";

export function ItemHeader(props: {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  onNameChange: (value: string) => void;
  onSubtitleChange: (value: string) => void;
  onNameCommit?: (value: string) => void;
  onDescriptionCommit?: (value: string) => void;
}) {
  const { id, name, subtitle, onNameChange, onSubtitleChange, onNameCommit } = props;
  return (
    <div className="mb-4">
      <div className="mb-2">
        <span className="rounded-sm border border-dashed border-foreground/25 px-1 py-0.5 text-xs font-mono text-muted-foreground/50">
          <span className="font-medium">ID:</span><span className="-tracking-widest"> </span><span className="tracking-wide">{id}</span>
        </span>
      </div>
      <input
        value={name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onNameChange(e.target.value)}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => onNameCommit?.(e.target.value)}
        placeholder="Item title"
        className="w-full appearance-none text-2xl font-semibold outline-none placeholder:text-gray-400 transition-colors focus:text-accent focus:placeholder:text-accent/65"
      />
      <TextareaAutosize
        value={subtitle}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onSubtitleChange(e.target.value)}
        placeholder="Optional subtitle or short description"
        className="mt-2 w-full bg-transparent text-sm leading-6 resize-none outline-none placeholder:text-gray-400 transition-colors focus:text-accent focus:placeholder:text-accent/65"
        minRows={1}
      />
    </div>
  );
}

export default ItemHeader;


