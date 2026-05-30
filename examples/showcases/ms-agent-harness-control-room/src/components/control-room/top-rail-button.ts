import { cn } from "@/lib/utils";

export function topRailButtonClass(
  tone: "cyan" | "indigo" | "violet" | "slate",
) {
  return cn(
    "bg-background/95 shadow-sm backdrop-blur",
    tone === "cyan" &&
      "border-cyan-200 bg-cyan-50 !text-cyan-700 hover:bg-cyan-100 hover:!text-cyan-800 [&_svg]:!text-cyan-700",
    tone === "indigo" &&
      "border-indigo-200 bg-indigo-50 !text-indigo-700 hover:bg-indigo-100 hover:!text-indigo-800 [&_svg]:!text-indigo-700",
    tone === "violet" &&
      "border-violet-200 bg-violet-50 !text-violet-700 hover:bg-violet-100 hover:!text-violet-800 [&_svg]:!text-violet-700",
    tone === "slate" &&
      "border-slate-200 bg-slate-50 !text-slate-700 hover:bg-slate-100 hover:!text-slate-800 [&_svg]:!text-slate-700",
  );
}
