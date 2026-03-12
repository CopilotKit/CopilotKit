import { AgentState, TodoItem, TodoStatus } from "@/lib/types";
import { generateRandomId } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

interface TodoCardProps {
  todo: TodoItem;
  isDragging: boolean;
  onUpdate: (id: string, title: string, description: string) => void;
  onDelete: (id: string) => void;
  onUpdateStatus: (id: string, status: TodoStatus) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function TodoCard({ 
  todo, 
  isDragging,
  onUpdate,
  onDelete,
  onUpdateStatus,
  onDragStart,
  onDragEnd
}: TodoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || isEditingTitle || isEditingDescription) return;

    return draggable({
      element,
      getInitialData: () => ({ todoId: todo.id }),
      onDragStart: onDragStart,
      onDrop: onDragEnd,
    });
  }, [todo.id, isEditingTitle, isEditingDescription, onDragStart, onDragEnd]);

  const handleTitleBlur = () => {
    const newTitle = titleRef.current?.textContent?.trim() || todo.title;
    if (newTitle !== todo.title) {
      onUpdate(todo.id, newTitle, todo.description || "");
    }
    setIsEditingTitle(false);
  };

  const handleDescriptionBlur = () => {
    const newDescription = descriptionRef.current?.textContent?.trim() || "";
    if (newDescription !== todo.description) {
      onUpdate(todo.id, todo.title, newDescription);
    }
    setIsEditingDescription(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, isTitle: boolean) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (isTitle && titleRef.current) {
        titleRef.current.textContent = todo.title;
        titleRef.current.blur();
      } else if (descriptionRef.current) {
        descriptionRef.current.textContent = todo.description || "";
        descriptionRef.current.blur();
      }
    }
  };

  return (
    <div
      ref={cardRef}
      className={`bg-white/10 p-3 rounded-lg text-white relative group hover:bg-white/15 transition-all h-24 ${
        !isEditingTitle && !isEditingDescription ? "cursor-move" : ""
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3 h-full">
        {/* Checkbox button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUpdateStatus(todo.id, todo.status === "done" ? "todo" : "done");
          }}
          className={`flex-shrink-0 w-5 h-5 mt-0.5 rounded border-2 transition-all ${
            todo.status === "done"
              ? "bg-white/90 border-white"
              : "bg-white/10 border-white/50 hover:border-white/80"
          }`}
          title={todo.status === "done" ? "Mark incomplete" : "Mark complete"}
        >
          {todo.status === "done" && (
            <svg
              className="w-full h-full text-gray-800"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M5 13l4 4L19 7"></path>
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            onFocus={() => setIsEditingTitle(true)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => handleKeyDown(e, true)}
            className={`font-medium mb-1 truncate outline-none focus:bg-white/10 focus:px-1 focus:-mx-1 rounded cursor-text ${
              todo.status === "done" ? "line-through opacity-60" : ""
            }`}
            title={todo.title}
          >
            {todo.title}
          </div>
          <div
            ref={descriptionRef}
            contentEditable
            suppressContentEditableWarning
            onFocus={() => setIsEditingDescription(true)}
            onBlur={handleDescriptionBlur}
            onKeyDown={(e) => handleKeyDown(e, false)}
            className={`text-sm text-white/70 line-clamp-2 outline-none focus:bg-white/10 focus:px-1 focus:-mx-1 rounded cursor-text ${
              todo.status === "done" ? "line-through opacity-50" : ""
            } ${!todo.description ? "text-white/40" : ""}`}
            title={todo.description || "Click to add description"}
          >
            {todo.description || "Add description..."}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(todo.id);
            }}
            className="text-white/70 hover:text-red-300 transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

interface ColumnDropZoneProps {
  status: TodoStatus;
  children: React.ReactNode;
  onDrop: (status: TodoStatus) => void;
}

function ColumnDropZone({ status, children, onDrop }: ColumnDropZoneProps) {
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const element = dropZoneRef.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => {
        setIsOver(false);
        onDrop(status);
      },
    });
  }, [status, onDrop]);

  return (
    <div
      ref={dropZoneRef}
      className={`flex flex-col gap-3 md:flex-1 p-2 rounded-lg transition-colors md:overflow-y-auto md:min-h-0 ${
        isOver ? "bg-white/10" : ""
      }`}
    >
      {children}
    </div>
  );
}

export interface TodoBoardProps {
  state: AgentState;
  setState: (state: AgentState) => void;
}

export function TodoBoard({ state, setState }: TodoBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const columns: { title: string; status: TodoStatus; bgColor: string }[] = [
    { title: "Todo", status: "todo", bgColor: "bg-indigo-400/25" },
    { title: "In-Progress", status: "in-progress", bgColor: "bg-purple-400/25" },
    { title: "Done", status: "done", bgColor: "bg-teal-400/25" },
  ];

  const updateTodo = (id: string, title: string, description: string) => {
    const updatedTodos = state.todos.map((todo) =>
      todo.id === id
        ? { ...todo, title, description: description || undefined }
        : todo
    );
    setState({ todos: updatedTodos });
  };

  const updateTodoStatus = (id: string, newStatus: TodoStatus) => {
    const updatedTodos = state.todos.map((todo) =>
      todo.id === id ? { ...todo, status: newStatus } : todo
    );
    setState({ todos: updatedTodos });
  };

  const deleteTodo = (id: string) => {
    setState({ todos: state.todos.filter((todo) => todo.id !== id) });
  };

  const handleDrop = (newStatus: TodoStatus) => {
    if (draggedId) {
      updateTodoStatus(draggedId, newStatus);
    }
  };

  const addNewTodo = (status: TodoStatus) => {
    const newTodo: TodoItem = {
      id: generateRandomId(),
      title: "New task",
      description: undefined,
      status: status,
    };
    setState({ todos: [...state.todos, newTodo] });
  };

  return (
    <div className="w-full h-full flex flex-col p-4 md:p-8">
      <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 text-center">
        Todo Board
      </h1>
      <p className="text-white/80 text-center italic mb-6 md:mb-8">
        Manage your tasks with the help of your AI assistant! 🪁
      </p>

      <div className="flex flex-col md:grid md:grid-cols-3 gap-4 md:gap-6 flex-1 md:min-h-0 overflow-y-auto md:overflow-visible">
        {columns.map((column) => (
          <div key={column.status} className="flex flex-col md:min-h-0 gap-3">
            <div
              className={`${column.bgColor} backdrop-blur-sm p-3 rounded-xl`}
            >
              <h2 className="text-lg font-bold text-white text-center">
                {column.title}
              </h2>
            </div>

            {/* Add new task button */}
            <button
              onClick={() => addNewTodo(column.status)}
              className="w-full py-2.5 text-white/60 hover:text-white/90 border border-dashed border-white/20 hover:border-white/40 hover:bg-white/5 rounded-lg transition-all text-sm flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Task
            </button>

            <ColumnDropZone status={column.status} onDrop={handleDrop}>
              {state.todos
                ?.filter((todo) => todo.status === column.status)
                .map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    isDragging={draggedId === todo.id}
                    onUpdate={updateTodo}
                    onDelete={deleteTodo}
                    onUpdateStatus={updateTodoStatus}
                    onDragStart={() => setDraggedId(todo.id)}
                    onDragEnd={() => setDraggedId(null)}
                  />
                ))}

              {state.todos?.filter((todo) => todo.status === column.status)
                .length === 0 && (
                <p className="text-center text-white/60 italic text-sm mt-4">
                  No tasks yet
                </p>
              )}
            </ColumnDropZone>
          </div>
        ))}
      </div>
    </div>
  );
}