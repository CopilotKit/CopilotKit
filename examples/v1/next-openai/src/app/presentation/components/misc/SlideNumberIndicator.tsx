interface SlideNumberIndicatorProps {
  currentSlideIndex: number;
  totalSlides: number;
}

export function SlideNumberIndicator({
  currentSlideIndex,
  totalSlides,
}: SlideNumberIndicatorProps) {
  return (
    <div className="flex-1 items-center justify-center flex uppercase text-xs font-bold tracking-widest">
      <span className="mr-3">{SLIDES_ICON}</span>
      Slide {currentSlideIndex + 1} of {totalSlides}
    </div>
  );
}

const SLIDES_ICON = (
  <svg
    width="10px"
    height="10px"
    viewBox="0 0 42 42"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
  >
    <rect x="0" y="0" width="10" height="10" />
    <rect x="16" y="0" width="10" height="10" />
    <rect x="32" y="0" width="10" height="10" />
    <rect x="0" y="16" width="10" height="10" />
    <rect x="16" y="16" width="10" height="10" />
    <rect x="32" y="16" width="10" height="10" />
    <rect x="0" y="32" width="10" height="10" />
    <rect x="16" y="32" width="10" height="10" />
    <rect x="32" y="32" width="10" height="10" />
  </svg>
);
