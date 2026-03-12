const suggestions = [
  { icon: 'person', label: 'Profile card' },
  { icon: 'thermostat', label: 'Weather widget' },
  { icon: 'task_alt', label: 'Todo list' },
  { icon: 'music_note', label: 'Music player' },
];

interface PreviewGalleryProps {
  onSelect?: (label: string) => void;
}

export function PreviewGallery({ onSelect }: PreviewGalleryProps) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {suggestions.map((s) => (
        <button
          key={s.label}
          onClick={() => onSelect?.(s.label)}
          className="flex items-center gap-2 rounded-full border border-white/80 bg-white/50 px-4 py-2 text-sm text-muted-foreground transition-all hover:bg-white/70 hover:text-foreground cursor-pointer"
        >
          <span className="material-symbols-rounded text-lg">{s.icon}</span>
          {s.label}
        </button>
      ))}
    </div>
  );
}
