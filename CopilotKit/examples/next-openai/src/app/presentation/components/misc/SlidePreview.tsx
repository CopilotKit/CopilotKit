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
      <div className=" w-full relative max-w-xs">
        <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-blue-500 to-teal-500 transform scale-[0.80] bg-red-500 rounded-full blur-3xl" />
        <div className="relative shadow-xl bg-gray-900 border border-gray-800  px-4 py-8 h-full overflow-hidden rounded-2xl flex flex-col justify-end items-start">
          <h1 className="font-bold text-xl text-white mb-4 relative z-50">
            {done ? doneLabel : inProgressLabel}
          </h1>
          <p className="font-normal text-base text-slate-500 mb-4 relative z-50 whitespace-pre">
            {content}
          </p>
          {spokenNarration && (
            <p className="font-normal text-sm text-slate-500 mb-4 relative z-50">
              &quot;{spokenNarration}&quot;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
