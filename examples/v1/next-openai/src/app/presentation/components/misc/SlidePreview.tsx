interface SlidePreviewProps {
  inProgressLabel: string;
  doneLabel: string;
  title?: string;
  content?: string;
  spokenNarration?: string;
  done?: boolean;
}

export function SlidePreview({
  content,
  spokenNarration,
  done,
  doneLabel,
  inProgressLabel,
}: SlidePreviewProps) {
  return (
    <div className="">
      <div className="relative w-full max-w-xs">
        <div className="absolute inset-0 h-full w-full scale-[0.80] transform rounded-full bg-red-500 bg-gradient-to-r from-blue-500 to-teal-500 blur-3xl" />
        <div className="relative flex h-full flex-col items-start justify-end overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 px-4 py-8 shadow-xl">
          <h1 className="relative z-50 mb-4 text-xl font-bold text-white">
            {done ? doneLabel : inProgressLabel}
          </h1>
          <p className="relative z-50 mb-4 whitespace-pre text-base font-normal text-slate-500">
            {content}
          </p>
          {spokenNarration && (
            <p className="relative z-50 mb-4 text-sm font-normal text-slate-500">
              &quot;{spokenNarration}&quot;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
