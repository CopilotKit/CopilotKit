import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  height?: number;
  width?: number;
}

export function Logo({ className, height=40, width=150 }: LogoProps) {

  return (
    <div className={cn("flex md:pb-4 md:pl-2", className)}>
      <Image src={"https://cdn.copilotkit.ai/docs/copilotkit/copilotkit-logo-light.png"} width={width} height={height} alt="Logo" className="block dark:hidden" />
      <Image src={"https://cdn.copilotkit.ai/docs/copilotkit/copilotkit-logo-dark.png"} width={width} height={height} alt="Logo" className="hidden dark:block" />
    </div>
  )
  
}