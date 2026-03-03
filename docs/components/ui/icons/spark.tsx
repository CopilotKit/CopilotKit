import { cn } from "@/lib/utils";

interface SparkIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const SparkIcon = ({ className }: SparkIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <g clipPath="url(#a)">
      <path
        fill="currentColor"
        d="m15.436 10.083-4.03-1.49-1.484-4.032a1.244 1.244 0 0 0-2.335 0L6.095 8.594 2.06 10.078a1.244 1.244 0 0 0 0 2.335l4.033 1.493 1.484 4.033a1.243 1.243 0 0 0 2.334 0l1.494-4.033 4.033-1.484a1.243 1.243 0 0 0 0-2.335l-.003-.004Zm-4.733 2.747a.626.626 0 0 0-.37.37L8.75 17.488l-1.58-4.285a.625.625 0 0 0-.373-.373l-4.285-1.58 4.285-1.58a.625.625 0 0 0 .373-.373l1.58-4.285 1.58 4.285a.626.626 0 0 0 .37.37l4.288 1.583-4.285 1.58Zm.547-9.705a.625.625 0 0 1 .625-.625h1.25V1.25a.625.625 0 1 1 1.25 0V2.5h1.25a.625.625 0 1 1 0 1.25h-1.25V5a.625.625 0 1 1-1.25 0V3.75h-1.25a.625.625 0 0 1-.625-.625Zm8.125 3.75a.625.625 0 0 1-.625.625h-.625v.625a.625.625 0 1 1-1.25 0V7.5h-.625a.625.625 0 1 1 0-1.25h.625v-.625a.625.625 0 1 1 1.25 0v.625h.625a.625.625 0 0 1 .625.625Z"
      />
    </g>
    <defs>
      <clipPath id="a">
        <path fill="#fff" d="M0 0h20v20H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default SparkIcon;
