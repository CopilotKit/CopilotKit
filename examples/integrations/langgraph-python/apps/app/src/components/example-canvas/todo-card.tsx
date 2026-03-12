"use client";

import { useState, useRef, useEffect } from "react";

interface Todo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

interface TodoCardProps {
  todo: Todo;
  onToggleStatus: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onUpdateTitle: (todoId: string, title: string) => void;
  onUpdateDescription: (todoId: string, description: string) => void;
  onUpdateEmoji: (todoId: string, emoji: string) => void;
}

const EMOJI_OPTIONS = ["✅", "🔥", "🎯", "💡", "🚀"];

export function TodoCard({
  todo,
  onToggleStatus,
  onDelete,
  onUpdateTitle,
  onUpdateDescription,
  onUpdateEmoji,
}: TodoCardProps) {
  const [editingField, setEditingField] = useState<
    "title" | "description" | null
  >(null);
  const [editValue, setEditValue] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isCompleted = todo.status === "completed";
  const truncatedDescription =
    todo.description.length > 120
      ? todo.description.slice(0, 120) + "..."
      : todo.description;

  const startEdit = (field: "title" | "description") => {
    setEditingField(field);
    setEditValue(field === "title" ? todo.title : todo.description);
  };

  const saveEdit = (field: "title" | "description") => {
    if (editValue.trim()) {
      if (field === "title") {
        onUpdateTitle(todo.id, editValue.trim());
      } else {
        onUpdateDescription(todo.id, editValue.trim());
      }
    }
    setEditingField(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [editValue]);

  return (
    <div
      className={`group relative rounded-2xl p-5 transition-all duration-150 border ${
        isCompleted
          ? "bg-neutral-100 border-neutral-200 dark:bg-neutral-800/50 dark:border-neutral-700"
          : "bg-white border-neutral-300 dark:bg-neutral-800 dark:border-neutral-700"
      }`}
    >
      {/* Delete — top right on hover */}
      <button
        onClick={() => onDelete(todo)}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-100 cursor-pointer rounded-full p-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        aria-label="Delete todo"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Emoji avatar */}
      <div className="relative inline-block mb-3">
        <button
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className={`block text-3xl leading-none cursor-pointer rounded-xl p-2 transition-colors duration-100 ${
            isCompleted
              ? "bg-neutral-200 dark:bg-neutral-700"
              : "bg-neutral-100 dark:bg-neutral-700/50"
          }`}
          aria-label="Change emoji"
        >
          {todo.emoji}
        </button>

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div className="absolute top-0 left-full ml-2 z-10 flex gap-1 p-1.5 rounded-full bg-white border border-neutral-300 shadow-lg dark:bg-neutral-800 dark:border-neutral-600">
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onUpdateEmoji(todo.id, emoji);
                  setShowEmojiPicker(false);
                }}
                className="text-lg w-8 h-8 flex items-center justify-center rounded-full cursor-pointer transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Title */}
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggleStatus(todo)}
          className="flex-shrink-0 mt-[2px] cursor-pointer"
          aria-label={isCompleted ? "Mark as incomplete" : "Mark as complete"}
        >
          {isCompleted ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="1" y="1" width="18" height="18" rx="6" className="fill-neutral-900 dark:fill-neutral-100" />
              <path d="M6 10.5L8.5 13L14 7" className="stroke-white dark:stroke-neutral-900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="1" y="1" width="18" height="18" rx="6" className="stroke-neutral-300 dark:stroke-neutral-600" strokeWidth="1.5" />
            </svg>
          )}
        </button>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          {editingField === "title" ? (
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit("title")}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit("title");
                if (e.key === "Escape") cancelEdit();
              }}
              className="w-full text-[16px] font-semibold focus:outline-none bg-transparent text-neutral-900 dark:text-neutral-100 border-b-2 border-neutral-900 dark:border-neutral-100 pb-[2px]"
              autoFocus
              aria-label="Edit todo title"
            />
          ) : (
            <div
              onClick={() => startEdit("title")}
              className={`text-[16px] font-semibold cursor-text break-words leading-snug ${
                isCompleted
                  ? "text-neutral-400 line-through dark:text-neutral-500"
                  : "text-neutral-900 dark:text-neutral-100"
              }`}
            >
              {todo.title}
            </div>
          )}

          {editingField === "description" ? (
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit("description")}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
              }}
              className="w-full mt-1.5 text-[14px] leading-relaxed focus:outline-none resize-none bg-transparent text-neutral-500 dark:text-neutral-400 border-b-2 border-neutral-900 dark:border-neutral-100 pb-[2px]"
              rows={1}
              autoFocus
              aria-label="Edit todo description"
            />
          ) : (
            <p
              onClick={() => startEdit("description")}
              className={`mt-1.5 text-[14px] leading-relaxed cursor-text ${
                isCompleted
                  ? "text-neutral-300 line-through dark:text-neutral-600"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {truncatedDescription}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
