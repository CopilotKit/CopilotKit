import { cn } from "@/lib/utils";

interface MessageCircleIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const MessageCircleIcon = ({ className }: MessageCircleIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M10 1.875a8.125 8.125 0 0 0-7.173 11.944l-.887 2.66A1.25 1.25 0 0 0 3.52 18.06l2.66-.887A8.125 8.125 0 1 0 10 1.875Zm0 15a6.865 6.865 0 0 1-3.442-.923.625.625 0 0 0-.511-.052l-2.922.975.974-2.922a.625.625 0 0 0-.051-.51A6.875 6.875 0 1 1 10 16.874Z"
    />
  </svg>
);
export default MessageCircleIcon;
