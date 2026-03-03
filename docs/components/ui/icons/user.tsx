import { cn } from "@/lib/utils";

interface UserIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const UserIcon = ({ className }: UserIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M18.04 16.562c-1.19-2.057-3.023-3.532-5.163-4.23a5.625 5.625 0 1 0-5.754 0c-2.14.698-3.974 2.173-5.164 4.23a.625.625 0 1 0 1.082.625c1.472-2.543 4.074-4.062 6.959-4.062s5.487 1.519 6.959 4.062a.624.624 0 1 0 1.082-.625ZM5.626 7.5a4.375 4.375 0 1 1 8.75 0 4.375 4.375 0 0 1-8.75 0Z"
    />
  </svg>
);
export default UserIcon;
