"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Bookmark, Check, X, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/context/dashboard-context";

export function DashboardToolbar() {
  const { currentDashboardName, saveCurrent } = useDashboard();

  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSaveInput) saveInputRef.current?.focus();
  }, [showSaveInput]);

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name || saving) return;
    setSaving(true);
    await saveCurrent(name);
    setSaveName("");
    setShowSaveInput(false);
    setSaving(false);
  };

  return (
    <div className="flex items-center gap-2 px-8 pt-6">
      {currentDashboardName && (
        <span className="text-xs text-muted-foreground">
          Current:{" "}
          <span className="font-medium text-foreground">
            {currentDashboardName}
          </span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Save button / input */}
        {showSaveInput ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={saveInputRef}
              type="text"
              placeholder="Dashboard name..."
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") setShowSaveInput(false);
              }}
              className="h-8 w-48 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring/30"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => void handleSave()}
              disabled={!saveName.trim() || saving}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setShowSaveInput(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSaveInput(true)}
          >
            <Bookmark className="h-3.5 w-3.5" />
            Save
          </Button>
        )}

        {/* Browse all dashboards */}
        <Button size="sm" variant="outline" asChild>
          <Link href="/dashboards">
            <LayoutGrid className="h-3.5 w-3.5" />
            Browse All
          </Link>
        </Button>
      </div>
    </div>
  );
}
