import { cn } from "@/lib/utils";

interface MessageIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const MessageIcon = ({ className }: MessageIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M16.875 3.75H3.125A1.25 1.25 0 0 0 1.875 5v12.5a1.237 1.237 0 0 0 .723 1.133 1.241 1.241 0 0 0 1.328-.178l.007-.006 2.551-2.199h10.391a1.25 1.25 0 0 0 1.25-1.25V5a1.25 1.25 0 0 0-1.25-1.25Zm0 11.25H6.25a.626.626 0 0 0-.409.152L3.125 17.5V5h13.75v10Z"
    />
  </svg>
);
export default MessageIcon;
