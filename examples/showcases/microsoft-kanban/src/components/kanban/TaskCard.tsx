"use client";

import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import type { KanbanTask } from "@/lib/kanban/types";

interface TaskCardProps {
  task: KanbanTask;
  onUpdateTitle?: (title: string) => void;
  onUpdateSubtitle?: (subtitle: string) => void;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
}

export default function TaskCard({
  task,
  onUpdateTitle,
  onUpdateSubtitle,
  onAddTag,
  onRemoveTag,
}: TaskCardProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingSubtitle, setIsEditingSubtitle] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);

  const [titleValue, setTitleValue] = useState(task.title);
  const [subtitleValue, setSubtitleValue] = useState(task.subtitle);
  const [newTagValue, setNewTagValue] = useState("");

  const titleInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingSubtitle && subtitleInputRef.current) {
      subtitleInputRef.current.focus();
    }
  }, [isEditingSubtitle]);

  useEffect(() => {
    if (isAddingTag && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [isAddingTag]);

  const handleTitleBlur = () => {
    if (titleValue.trim() !== "" && titleValue !== task.title && onUpdateTitle) {
      onUpdateTitle(titleValue);
    } else {
      setTitleValue(task.title);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setTitleValue(task.title);
      setIsEditingTitle(false);
    }
  };

  const handleSubtitleBlur = () => {
    if (subtitleValue !== task.subtitle && onUpdateSubtitle) {
      onUpdateSubtitle(subtitleValue);
    }
    setIsEditingSubtitle(false);
  };

  const handleSubtitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setSubtitleValue(task.subtitle);
      setIsEditingSubtitle(false);
    }
  };

  const handleAddTag = () => {
    const trimmedTag = newTagValue.trim();
    if (trimmedTag !== "" && !task.tags.includes(trimmedTag) && onAddTag) {
      onAddTag(trimmedTag);
    }
    setNewTagValue("");
    setIsAddingTag(false);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddTag();
    } else if (e.key === "Escape") {
      setNewTagValue("");
      setIsAddingTag(false);
    }
  };

  return (
    <Card className="p-3 space-y-2 hover:shadow-md transition-shadow">
      {isEditingTitle ? (
        <input
          ref={titleInputRef}
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          className="font-medium w-full text-sm bg-transparent border border-input rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <div
          onClick={() => setIsEditingTitle(true)}
          className="font-medium text-sm cursor-pointer hover:bg-accent/50 rounded px-2 py-1 -mx-2 -my-1"
          title="Click to edit title"
        >
          {task.title}
        </div>
      )}

      {isEditingSubtitle ? (
        <input
          ref={subtitleInputRef}
          value={subtitleValue}
          onChange={(e) => setSubtitleValue(e.target.value)}
          onBlur={handleSubtitleBlur}
          onKeyDown={handleSubtitleKeyDown}
          className="text-xs text-muted-foreground w-full bg-transparent border border-input rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Add subtitle..."
        />
      ) : (
        <div
          onClick={() => setIsEditingSubtitle(true)}
          className="text-xs text-muted-foreground cursor-pointer hover:bg-accent/50 rounded px-2 py-1 -mx-2 -my-1"
          title="Click to edit subtitle"
        >
          {task.subtitle || <span className="opacity-50">Add subtitle...</span>}
        </div>
      )}

      {task.description && (
        <div
          onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
          className={`text-xs text-muted-foreground cursor-pointer hover:bg-accent/50 rounded px-2 py-1 -mx-2 -my-1 ${
            isDescriptionExpanded ? "" : "line-clamp-2"
          }`}
          title="Click to expand/collapse"
        >
          {task.description}
        </div>
      )}

      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 text-black"
            >
              {tag}
              {onRemoveTag && (
                <X
                  className="h-3 w-3 cursor-pointer hover:text-destructive"
                  onClick={() => onRemoveTag(tag)}
                />
              )}
            </span>
          ))}
        </div>
      )}

      {isAddingTag ? (
        <input
          ref={tagInputRef}
          value={newTagValue}
          onChange={(e) => setNewTagValue(e.target.value)}
          onBlur={handleAddTag}
          onKeyDown={handleTagKeyDown}
          placeholder="Enter tag name..."
          className="text-xs w-full bg-transparent border border-input rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => setIsAddingTag(true)}
        >
          <Plus className="h-3 w-3 mr-1" /> Tag
        </Button>
      )}
    </Card>
  );
}
