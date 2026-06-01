"use client";
import { useEffect, useState } from "react";

interface Toast {
  id: number;
  message: string;
}

let nextId = 0;
const listeners: Set<(toast: Toast) => void> = new Set();

export function showErrorToast(message: string): void {
  const toast: Toast = { id: nextId++, message };
  listeners.forEach((fn) => fn(toast));
}

export function BaselineToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 5000);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--danger)] text-white shadow-lg"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
