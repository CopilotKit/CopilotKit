import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AngleSelectorProps {
  args: any;
  respond?: (value: string) => void;
  status?: any;
  editor?: any;
  currentDocument?: string;
  setCurrentDocument?: (document: string) => void;
}

export function AngleSelector({ args, respond }: AngleSelectorProps) {
  const angles: string[] = useMemo(() => {
    const a = args?.angles ?? args?.options ?? [];
    if (Array.isArray(a)) return a.map((v) => String(v));
    if (typeof a === "string") return a.split(",").map((s) => s.trim()).filter(Boolean);
    return [];
  }, [args]);


  useEffect(() => {
    console.log(angles, "anglesanglesangles");
  }, [angles]);

  const [selected, setSelected] = useState<string>("");
  const [finalized, setFinalized] = useState<"confirmed" | "cancelled" | null>(null);

  const handleConfirm = () => {
    if (!selected || finalized) return;
    setFinalized("confirmed");
    respond?.(selected);
    // onConfirm();
  };

  const handleCancel = () => {
    if (finalized) return;
    setFinalized("cancelled");
    respond?.("cancelled");
    // onReject();
  };

  return (
    <div className="w-full max-w-xl rounded-2xl border bg-card shadow-sm">
      <div className="p-4 border-b bg-accent/5 rounded-t-2xl">
        <p className="text-sm text-muted-foreground">
          I have pulled the required info. Please select from any of the angles.
        </p>
      </div>
      <div className="p-4">
        {angles.length ? (
          <div className="flex flex-wrap gap-1.5 md:gap-2 max-h-60 overflow-auto scroll-thin">
            {angles.map((label) => {
              const isActive = selected === label;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => !finalized && setSelected(label)}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs md:text-sm shadow-xs",
                    "transition-all bg-card/80 hover:bg-accent/10 hover:border-accent/50",
                    "backdrop-blur-sm",
                    isActive && "bg-accent/20 text-accent border-accent/60 ring-2 ring-accent/25",
                    finalized && "pointer-events-none opacity-70"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No angles available.</div>
        )}
      </div>
      <div className="p-4 pt-0 flex justify-end gap-2">
        {finalized ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
              finalized === "confirmed"
                ? "bg-accent/10 text-accent border-accent/40"
                : "bg-muted text-muted-foreground border-border"
            )}
          >
            {finalized === "confirmed" ? "Confirmed" : "Cancelled"}
          </span>
        ) : (
          <>
            <Button variant="outline" onClick={handleCancel}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={!selected}>Confirm</Button>
          </>
        )}
      </div>
    </div>
  );
}

export default AngleSelector;