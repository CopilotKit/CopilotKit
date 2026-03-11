"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CustomCodeBlockProps {
  code: string;
}

const CustomCodeBlock = ({ code }: CustomCodeBlockProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlightCode = (text: string) => {
    return text.replace(
      /(\S+@\S+)/g,
      '<span class="text-emerald-600 dark:text-emerald-400">$1</span>',
    );
  };

  return (
    <div className="relative mt-4 rounded-lg border border-black/6 bg-[#FAFAFA] dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between px-4 py-3">
        <pre className="text-sm">
          <code
            className="font-mono text-[#010507] bg-transparent dark:text-white border-none!"
            dangerouslySetInnerHTML={{ __html: highlightCode(code) }}
          />
        </pre>
        <button
          onClick={handleCopy}
          className="ml-4 shrink-0 rounded p-1.5 text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200 cursor-pointer"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
};

export default CustomCodeBlock;
