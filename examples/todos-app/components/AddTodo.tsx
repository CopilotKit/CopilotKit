import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTasks } from "@/lib/hooks/use-tasks";

export function AddTodo() {
  const [title, setTitle] = useState("");
  const { addTask } = useTasks();

  const handleAddTask = () => {
    addTask(title);
    setTitle("");
  };

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <div className="flex items-center mb-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          type="text"
          placeholder="Add a new todo..."
          className="flex-1 mr-2 bg-muted text-muted-foreground rounded-md px-4 py-2"
        />
        <Button type="submit" disabled={!title} onClick={handleAddTask}>
          Add
        </Button>
      </div>
    </form>
  );
}
