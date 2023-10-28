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

import { DocumentPointer } from "@copilotkit/react-core";

export interface SourceSearchBoxProps {
  searchTerm: string;
  suggestedFiles: DocumentPointer[];
  onSelectedFile: (filePointer: DocumentPointer) => void;
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

        <CommandGroup heading="Available resources">
          {props.suggestedFiles.map((filePointer) => {
            return (
              <CommandItem
                key={`word-${filePointer.sourceApplication}.${filePointer.name}`}
                value={filePointer.name}
                onSelect={(value) => {
                  props.onSelectedFile(filePointer);
                }}
              >
                <div className="flex flex-row gap-3 items-center">
                  <Logo size="30px">
                    <img
                      src={filePointer.iconImageUri}
                      alt={filePointer.sourceApplication}
                      width={30}
                      height={30}
                    />
                  </Logo>
                  {filePointer.name}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* <CommandGroup heading="Suggestions">
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
        </CommandGroup> */}
        <CommandSeparator />
      </CommandList>
    </Command>
  );
}

export function Logo({
  children,
  size = "30px",
}: {
  children: React.ReactNode;
  size?: string;
}) {
  return (
    <div
      className="flex items-center justify-center bg-black"
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  );
}
