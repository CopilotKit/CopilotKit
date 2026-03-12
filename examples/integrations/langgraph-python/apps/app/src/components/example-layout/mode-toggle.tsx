interface ModeToggleProps {
  mode: 'chat' | 'app';
  onModeChange: (mode: 'chat' | 'app') => void;
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div
      className="fixed top-4 right-4 z-50 flex rounded-full border border-neutral-300 bg-neutral-200 p-0.5 max-lg:top-2 max-lg:right-2 max-lg:scale-90 dark:border-neutral-700 dark:bg-neutral-800"
    >
      <button
        onClick={() => onModeChange('chat')}
        className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer ${
          mode === 'chat'
            ? 'bg-white text-neutral-900 shadow-sm dark:bg-stone-900 dark:text-white'
            : 'text-neutral-500 dark:text-neutral-400'
        }`}
      >
        Chat
      </button>
      <button
        onClick={() => onModeChange('app')}
        className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer ${
          mode === 'app'
            ? 'bg-white text-neutral-900 shadow-sm dark:bg-stone-900 dark:text-white'
            : 'text-neutral-500 dark:text-neutral-400'
        }`}
      >
        Tasks
      </button>
    </div>
  );
}
