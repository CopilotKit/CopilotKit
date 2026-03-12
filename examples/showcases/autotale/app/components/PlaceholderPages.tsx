import { cn } from "@/lib/utils"
import { gradient, commonPageClass } from "./ChapterPage"

export function PlaceholderImagePage() {
  return (
    <div className={cn(commonPageClass, "rounded-l-lg bg-white")}>
      <div
        className={"h-full font-story flex flex-col"}
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      >
        <div className="flex-1 flex items-center justify-center text-2xl py-14 px-8 font-medium whitespace-pre-wrap">YOUR STORY</div>
      </div>
    </div>
  )
}

export function PlaceholderContentPage() {
  return (
    <div className={cn(commonPageClass, "rounded-r-lg bg-white")}>
      <div
        className={"h-full font-story flex flex-col"}
        style={{ background: `linear-gradient(to left, ${gradient})` }}
      >
        <div className="flex-1 flex text-lg py-14 px-8 font-medium whitespace-pre-wrap">Start chatting with the Storytale AI agent to generate your own story.</div>
      </div>
    </div>
  )
}