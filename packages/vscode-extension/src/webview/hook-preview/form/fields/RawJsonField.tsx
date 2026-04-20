import { useState } from "react";
import type { FormField } from "../schema/types";

/**
 * Editable JSON textarea. Local text state is seeded from `value` on mount and
 * does not re-sync on subsequent external `value` changes — acceptable for the
 * hook preview panel today, which treats this as a user-driven input only.
 * If callers start resetting values externally, sync on blur-out via a ref.
 */
export function RawJsonField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "raw-json" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `field-${field.name}`;
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    // Empty input means "no change" — don't clobber the prior value with {}.
    // A raw-json field may hold an array, string, or null, and silently
    // overwriting it with {} would be surprising.
    if (text.trim() === "") {
      setError(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50"
        >
          {field.label}
        </label>
        <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-white/50">
          JSON
        </span>
      </div>
      <div className="relative">
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={8}
          aria-invalid={error !== null}
          spellCheck={false}
          className="block w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-xs leading-relaxed text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50 aria-[invalid=true]:border-red-400/50 aria-[invalid=true]:ring-red-400/40"
          style={{
            tabSize: 2,
            minHeight: 140,
            fontFeatureSettings: '"liga" 0, "calt" 0',
          }}
        />
      </div>
      {field.hint ? (
        <small className="text-xs text-white/40">{field.hint}</small>
      ) : null}
      {error ? (
        <span
          role="alert"
          className="inline-flex items-center gap-1.5 rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-200"
        >
          <span aria-hidden>⚠</span>
          {error}
        </span>
      ) : null}
    </div>
  );
}
