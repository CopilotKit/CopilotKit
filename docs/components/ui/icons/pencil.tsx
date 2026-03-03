import { cn } from "@/lib/utils";

interface PencilIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const PencilIcon = ({ className }: PencilIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M18.125 2.5a.625.625 0 0 0-.625-.625c-3.444 0-6.977 3.884-8.94 6.455a4.688 4.688 0 0 0-6.06 4.482c0 2.413-1.527 3.495-1.6 3.545a.625.625 0 0 0 .35 1.143h5.938a4.688 4.688 0 0 0 4.481-6.06c2.573-1.963 6.456-5.496 6.456-8.94ZM7.187 16.25H2.705c.528-.75 1.045-1.881 1.045-3.438a3.438 3.438 0 1 1 3.438 3.438ZM9.72 8.871c.268-.347.53-.674.789-.98.63.426 1.174.97 1.6 1.6-.307.258-.634.52-.98.789A4.73 4.73 0 0 0 9.72 8.87Zm3.336-.21a7.23 7.23 0 0 0-1.718-1.718c2.482-2.698 4.355-3.516 5.46-3.743-.222 1.106-1.044 2.979-3.742 5.462Z"
    />
  </svg>
);
export default PencilIcon;
