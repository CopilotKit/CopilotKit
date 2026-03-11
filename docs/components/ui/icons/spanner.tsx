import { cn } from "@/lib/utils";

interface SpannerIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const SpannerIcon = ({ className }: SpannerIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M17.716 5.39a.626.626 0 0 0-1.004-.224L13.564 8.07l-1.346-.29-.29-1.345 2.906-3.149a.625.625 0 0 0-.225-1.003A5.625 5.625 0 0 0 6.875 7.5a5.652 5.652 0 0 0 .469 2.26L2.64 13.829l-.034.03a2.5 2.5 0 1 0 3.567 3.504l4.066-4.706A5.624 5.624 0 0 0 18.125 7.5a5.59 5.59 0 0 0-.41-2.11ZM12.5 11.876a4.386 4.386 0 0 1-2.115-.547.625.625 0 0 0-.775.138l-4.367 5.058a1.25 1.25 0 0 1-1.767-1.767L8.53 10.39a.625.625 0 0 0 .138-.775 4.375 4.375 0 0 1 4.56-6.43l-2.438 2.64a.625.625 0 0 0-.152.555l.443 2.057a.625.625 0 0 0 .48.48l2.058.442a.625.625 0 0 0 .554-.151l2.642-2.438a4.38 4.38 0 0 1-4.315 5.105Z"
    />
  </svg>
);
export default SpannerIcon;
