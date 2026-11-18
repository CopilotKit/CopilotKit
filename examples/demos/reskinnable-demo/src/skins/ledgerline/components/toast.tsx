"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Transient confirmations for the person's own actions (approve, allocate, reimburse). */
interface Toast {
  id: number;
  tone: "ok" | "error";
  title: string;
  body?: string;
}

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++counter;
    setToasts((all) => [...all, { ...t, id }]);
    window.setTimeout(
      () => setToasts((all) => all.filter((x) => x.id !== id)),
      4200,
    );
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="ledgerline-toast"
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-3 text-[0.8rem] shadow-lg",
              t.tone === "ok" ? "border-positive/30" : "border-negative/30",
            )}
          >
            {t.tone === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-negative" />
            )}
            <div>
              <div className="font-semibold text-ink">{t.title}</div>
              {t.body ? (
                <div className="mt-0.5 text-ink-muted">{t.body}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
