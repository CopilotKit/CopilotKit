import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import type { Board } from "@/lib/kanban/types";

interface BoardTabsProps {
  boards: Board[];
  activeBoardId: string;
  onSwitchBoard: (boardId: string) => void;
  onCreateBoard: () => void;
}

export default function BoardTabs({
  boards,
  activeBoardId,
  onSwitchBoard,
  onCreateBoard,
}: BoardTabsProps) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2 bg-background">
      <Tabs value={activeBoardId} onValueChange={onSwitchBoard}>
        <TabsList>
          {boards.map((board) => (
            <TabsTrigger
              key={board.id}
              value={board.id}
              className="max-w-[200px] truncate"
            >
              {board.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCreateBoard}
        className="ml-2"
        aria-label="Create new board"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
