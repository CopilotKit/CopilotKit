"use client";

import { BookOpenIcon } from "lucide-react";

const LearnHeader = () => {
  return (
    <div className="flex justify-between items-center p-2 mt-3 mb-3 w-full h-12 rounded-lg border bg-[#BEC2FF33] dark:bg-[#7076D533] border-[#7076D5] dark:border-[#BEC2FF] [box-shadow:0px_17px_12px_-10px_rgba(112,118,213,0.3)]">
      <div className="flex gap-2 items-center">
        <div className="flex justify-center items-center w-8 h-8 shrink-0 rounded-md bg-[#BEC2FF] dark:bg-[#7076D5]">
          <BookOpenIcon className="w-4 h-4 text-[#0C1112] dark:text-white" />
        </div>
        <span className="text-sm font-medium text-foreground">Learn</span>
      </div>
    </div>
  );
};

export default LearnHeader;
