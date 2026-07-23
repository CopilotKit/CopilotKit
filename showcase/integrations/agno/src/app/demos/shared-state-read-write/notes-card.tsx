"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./_components/card";
import { Button } from "./_components/button";

export interface NotesCardProps {
  notes: string[];
  onClear: () => void;
}

/**
 * Sidebar card that READS agent-authored notes out of shared state.
 *
 * The agent writes these via its `set_notes` tool. The UI reflects every
 * update in real time because the parent page subscribes via
 * `useAgent({ updates: [OnStateChanged] })` and passes `state.notes` in.
 *
 * The "Clear" button is a write-back (UI -> agent state) to demonstrate
 * both directions on the same field.
 */
// @region[notes-card-render]
// Read-side render: this card reflects the agent-authored `notes` slice
// of shared state. The parent page passes `state.notes` in; we never
// touch agent state ourselves — we just render it. The Clear button is
// a small write-back, exposed as an `onClear` prop.
export function NotesCard({ notes, onClear }: NotesCardProps) {
  return (
    <Card data-testid="notes-card" className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Agent Scratch pad</CardTitle>
            <CardDescription>
              The agent writes here via its{" "}
              <code className="font-mono text-[11px] text-[#010507]">
                set_notes
              </code>{" "}
              tool. The UI re-renders from shared state.
            </CardDescription>
          </div>
          {notes.length > 0 && (
            <Button
              type="button"
              onClick={onClear}
              data-testid="notes-clear-button"
              variant="destructive"
              size="sm"
              className="uppercase tracking-[0.14em] text-[10px]"
            >
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {notes.length === 0 ? (
          <div
            data-testid="notes-empty"
            className="text-sm text-[#838389] italic min-h-[160px] flex items-center justify-center text-center px-4 border border-dashed border-[#E9E9EF] rounded-xl bg-[#FAFAFC]"
          >
            the agent will make observations about you and note them here!
          </div>
        ) : (
          <ul
            data-testid="notes-list"
            className="space-y-2 text-sm text-[#010507]"
          >
            {notes.map((note, i) => (
              <li
                key={i}
                data-testid="note-item"
                className="flex gap-2 rounded-lg border border-[#E9E9EF] bg-[#FAFAFC] px-3 py-2"
              >
                <span className="text-[#838389] font-mono text-xs leading-5 select-none">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">{note}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
// @endregion[notes-card-render]
