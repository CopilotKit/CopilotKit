'use client';

interface WidgetInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
}

export function WidgetInput({ value, onChange, onSubmit, disabled }: WidgetInputProps) {
  const hasText = value.trim().length > 0;
  const canSubmit = hasText && !disabled;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && canSubmit) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="flex w-full max-w-3xl items-center gap-3 rounded-[28px] border border-white/80 bg-white/50 px-5 py-2.5 shadow-sm">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe your A2UI widget..."
        className="flex-1 resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground/50 min-h-[36px] max-h-[120px] py-1.5"
        rows={1}
        autoFocus
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = 'auto';
          target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
        }}
      />
      <button
        disabled={!canSubmit}
        onClick={onSubmit}
        className={`
          shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all self-end mb-0.5
          ${canSubmit
            ? 'bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white cursor-pointer'
            : 'bg-muted text-muted-foreground cursor-not-allowed'
          }
        `}
      >
        Create
      </button>
    </div>
  );
}
