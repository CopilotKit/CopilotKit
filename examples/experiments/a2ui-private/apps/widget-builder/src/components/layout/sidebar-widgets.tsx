"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWidgets } from "@/contexts/widgets-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface WidgetItemProps {
  id: string;
  name: string;
  isSelected: boolean;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onNavigate?: () => void;
}

function WidgetItem({
  id,
  name,
  isSelected,
  onRename,
  onDelete,
  onNavigate,
}: WidgetItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    setIsMenuOpen(false);
    setIsEditing(true);
    setEditValue(name);
  };

  const handleRenameSubmit = () => {
    const newName = editValue.trim() || "Untitled widget";
    onRename(newName);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(name);
    }
  };

  if (isEditing) {
    return (
      <div
        className={cn(
          "flex w-full items-center rounded-lg px-3 py-2",
          isSelected ? "bg-white shadow-sm" : "bg-white/50",
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={handleKeyDown}
          placeholder="Widget name"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <>
      <Link
        href={`/widget/${id}`}
        onClick={onNavigate}
        className={cn(
          "group flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer",
          isSelected
            ? "bg-white text-foreground shadow-sm"
            : "text-foreground hover:bg-white/50",
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span className="truncate flex-1">{name || "Untitled widget"}</span>

        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger
            onClick={(e) => e.preventDefault()}
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-black/5",
              isHovered || isMenuOpen ? "opacity-100" : "opacity-0",
            )}
          >
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                handleRename();
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                setShowDeleteDialog(true);
              }}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Link>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ?</AlertDialogTitle>
            <AlertDialogDescription>
              All widget studio is stored locally on your device so there is no
              backup. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              onClick={onDelete}
              className="w-full rounded-full bg-red-600 hover:bg-red-700 cursor-pointer"
            >
              Delete
            </AlertDialogAction>
            <AlertDialogCancel className="w-full rounded-full cursor-pointer">
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface SidebarWidgetsProps {
  onNavigate?: () => void;
}

export function SidebarWidgets({ onNavigate }: SidebarWidgetsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { widgets, loading, updateWidget, removeWidget } = useWidgets();

  const handleRename = (id: string, newName: string) => {
    updateWidget(id, { name: newName });
  };

  const handleDelete = (id: string) => {
    removeWidget(id);
    // Navigate to home if we're on the deleted widget's page
    if (pathname === `/widget/${id}`) {
      router.push("/");
    }
  };

  // Extract widget ID from pathname if on a widget page
  const currentWidgetId = pathname.startsWith("/widget/")
    ? pathname.replace("/widget/", "")
    : null;

  return (
    <div className="flex flex-col gap-2 h-full">
      <span className="px-3 text-xs font-medium text-muted-foreground">
        Widgets
      </span>
      <div className="flex flex-col gap-1 overflow-auto flex-1 min-h-0">
        {loading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : widgets.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            No widgets yet
          </div>
        ) : (
          widgets.map((widget) => (
            <WidgetItem
              key={widget.id}
              id={widget.id}
              name={widget.name}
              isSelected={currentWidgetId === widget.id}
              onRename={(newName) => handleRename(widget.id, newName)}
              onDelete={() => handleDelete(widget.id)}
              onNavigate={onNavigate}
            />
          ))
        )}
      </div>
    </div>
  );
}
