import { useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";

import {
  Calculator,
  Calendar,
  CreditCard,
  Settings,
  Smile,
  User,
} from "lucide-react";
import { IconForFilePointer } from "../hovering-toolbar/text-insertion-prompt-box/mode-suggestion-appearing";

export interface FilePointer {
  name: string;
  sourceApplication: string;
  getContents: () => Promise<string>;
}

export interface SourceSearchBoxProps {
  searchTerm: string;
  recentFiles: FilePointer[];
  onSelectedFile: (filePointer: FilePointer) => void;
}

export function SourceSearchBox(props: SourceSearchBoxProps) {

  const [selectedValue, setSelectedValue] = useState<string>("");

  return (
    <Command
      className="rounded-lg border shadow-md"
      value={selectedValue}
      onValueChange={(value) => {
        setSelectedValue(value);
      }}
      filter={(value, search) => {
        // if the search term is empty, show all commands
        if (props.searchTerm === "") return 1;

        // if the search term is a prefix of the command, show it
        if (value.startsWith(props.searchTerm)) return 1;

        // otherwise, don't show it
        return 0;
      }}
    >
      <CommandInput
        value={props.searchTerm}
        className="rounded-t-lg hidden"
        placeholder="Search for a command..."
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Recents">
          {props.recentFiles.map((filePointer) => {
            return (
              <CommandItem
                key={`word-${filePointer.sourceApplication}.${filePointer.name}`}
                value={filePointer.name}
                onSelect={(value) => {
                  console.log(filePointer.name)
                  props.onSelectedFile(filePointer);
                }}
              >
                <div className="flex flex-row gap-3 items-center bg-slate-400 ">
                <Logo size="40px">
                  <IconForFilePointer filePointer={filePointer} className="mx-auto my-auto" />
                </Logo>
                {filePointer.name}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandGroup heading="Suggestions">
          <CommandItem
            onSelect={(value) => {
              console.log(value);
              console.log(value);
            }}
          >
            <Calendar className="mr-2 h-4 w-4" />
            <span>Calendar</span>
          </CommandItem>
          <CommandItem>
            <Smile className="mr-2 h-4 w-4" />
            <span>Search Emoji</span>
          </CommandItem>
          <CommandItem>
            <Calculator className="mr-2 h-4 w-4" />
            <span>Calculator</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
      </CommandList>
    </Command>
  );
}

export function Logo({ children, size = '20px' }: { children: React.ReactNode; size?: string }) {
  return (
    <div
      className={""}
      style={{
        width: size,
        height: size,
      }}
    >
      <div className={""}>
        {children}
      </div>
    </div>
  )
}
