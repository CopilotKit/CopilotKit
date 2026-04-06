"use client";

import { useState, useEffect } from "react";
import { SearchModal } from "./search-modal";

export function SearchTrigger() {
    const [isMac, setIsMac] = useState(true);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
        setIsMac(mac);
    }, []);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
            if (e.key === "Escape") setOpen(false);
        }
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-muted)] cursor-pointer hover:border-[var(--text-faint)] transition-colors min-w-[200px]"
            >
                <span>⌕</span>
                <span>Search docs, demos...</span>
                <span className="ml-auto font-mono text-[10px] border border-[var(--border)] px-1 py-0.5 rounded bg-[var(--bg-surface)]">
                    {isMac ? "⌘K" : "Ctrl+K"}
                </span>
            </button>
            {open && <SearchModalWrapper onClose={() => setOpen(false)} />}
        </>
    );
}

function SearchModalWrapper({ onClose }: { onClose: () => void }) {
    return <SearchModal onClose={onClose} />;
}
