import { cn } from "@/lib/utils";

interface LampIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const LampIcon = ({ className }: LampIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M13.75 18.125a.625.625 0 0 1-.625.625h-6.25a.625.625 0 1 1 0-1.25h6.25a.625.625 0 0 1 .625.625Zm3.125-10a6.84 6.84 0 0 1-2.628 5.407 1.268 1.268 0 0 0-.497 1V15a1.25 1.25 0 0 1-1.25 1.25h-5A1.25 1.25 0 0 1 6.25 15v-.469a1.25 1.25 0 0 0-.487-.989 6.842 6.842 0 0 1-2.638-5.379c-.02-3.723 2.99-6.824 6.71-6.913a6.875 6.875 0 0 1 7.04 6.875Zm-1.25 0A5.626 5.626 0 0 0 9.865 2.5c-3.048.072-5.506 2.609-5.49 5.656a5.598 5.598 0 0 0 2.16 4.398 2.498 2.498 0 0 1 .965 1.977V15h5v-.469a2.513 2.513 0 0 1 .974-1.98 5.596 5.596 0 0 0 2.151-4.426Zm-1.259-.73A4.5 4.5 0 0 0 10.73 3.76a.625.625 0 1 0-.208 1.232c1.295.218 2.393 1.317 2.613 2.614a.625.625 0 0 0 1.232-.21Z"
    />
  </svg>
);
export default LampIcon;
