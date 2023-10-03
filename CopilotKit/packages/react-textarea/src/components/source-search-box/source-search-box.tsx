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

export interface FilePointer {
  name: string;
  sourceApplication: string;
  getContents: () => Promise<string>;
}

export interface SourceSearchBoxProps {
  searchTerm: string;

  recentFiles: FilePointer[];
}

export function SourceSearchBox(props: SourceSearchBoxProps) {
  return (
    <Command
      className="rounded-lg border shadow-md"
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

        <CommandGroup heading="Recent files">
          {props.recentFiles.map((filePointer) => {
            return (
              <CommandItem
                key={`word-${filePointer.sourceApplication}.${filePointer.name}`}
                value={filePointer.name}
                // onSelect={(value) => {
                //   console.log(filePointer.name)
                // }}
              >
                {filePointer.name}
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
