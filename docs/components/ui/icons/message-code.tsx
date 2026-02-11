import { cn } from "@/lib/utils";

interface MessageCodeIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const MessageCodeIcon = ({ className }: MessageCodeIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <g fill="currentColor">
      <path d="M16.875 3.75H3.125A1.25 1.25 0 0 0 1.875 5v12.5a1.237 1.237 0 0 0 .723 1.133 1.241 1.241 0 0 0 1.328-.178l.007-.006 2.551-2.199h10.391a1.25 1.25 0 0 0 1.25-1.25V5a1.25 1.25 0 0 0-1.25-1.25Zm0 11.25H6.25a.626.626 0 0 0-.409.152L3.125 17.5V5h13.75v10Z" />
      <path d="m5.6 10.303 2.5 2.5a.626.626 0 0 0 .884-.884L6.926 9.86l2.058-2.058a.625.625 0 0 0-.884-.884l-2.5 2.5a.625.625 0 0 0 0 .884ZM11.428 12.939a.623.623 0 0 1-.339-.818.623.623 0 0 1 .136-.202l2.059-2.058-2.059-2.058a.625.625 0 1 1 .884-.884l2.5 2.5a.626.626 0 0 1 0 .884l-2.5 2.5a.623.623 0 0 1-.681.136Z" />
    </g>
  </svg>
);
export default MessageCodeIcon;
