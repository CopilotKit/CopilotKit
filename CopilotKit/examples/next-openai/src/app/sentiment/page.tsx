"use client";

import { useState, useCallback, useRef } from "react";
import { CopilotKit, extract, useCopilotContext, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";

export default function SentimentPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit/openai">
      <Sentiment />
    </CopilotKit>
  );
}

function Sentiment() {
  const [comment, setComment] = useState("");
  const [text, setText] = useState("");
  const [sentiment, setSentiment] = useState(0);
  const [isImproving, setIsImproving] = useState(false); // Added state for loading indication
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const debounce = (func: (...args: any[]) => void, delay: number) => {
    return (...args: any[]) => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
      debounceTimeout.current = setTimeout(() => {
        func(...args);
      }, delay);
    };
  };

  const context = useCopilotContext();

  const updateSentiment = async (newText: string) => {
    if (abortController.current) {
      abortController.current.abort();
    }
    abortController.current = new AbortController();

    if (text.trim() == newText.trim()) {
      return;
    }

    try {
      const { sentiment, comment } = await extract({
        abortSignal: abortController.current.signal,
        context,
        data: { text: newText },
        instructions:
          "Analyze the sentiment of the provided text. The text might be unfinished, that's ok, it's being analyzed while the user is typing.",
        parameters: [
          {
            name: "sentiment",
            description: "A value between 1 and 10, where 1 is good and 10 is bad.",
            type: "number",
          },
          {
            name: "comment",
            description:
              "A comment (max 2-3 words) about the text. You MUST always use emojis in the comment.",
          },
        ],
      });
      setSentiment(sentiment);
      setComment(comment);
    } catch {}
  };

  const debouncedUpdateSentiment = useCallback(debounce(updateSentiment, 300), []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    debouncedUpdateSentiment(newText);
  };

  const handleImproveText = async () => {
    setIsImproving(true); // Set loading state to true
    try {
      const { improvedText } = await extract({
        context,
        data: { text, sentiment, comment },
        parameters: [{ name: "improvedText", description: "The improved text." }],
        instructions:
          "Improve the provided text. Have a look at the sentiment value (1 is good, 10 is bad) and the comment.",
      });
      setText(improvedText);
      updateSentiment(improvedText);
    } finally {
      setIsImproving(false); // Set loading state to false
    }
  };

  const getBackgroundColor = (sentiment: number) => {
    const red = Math.min(255, Math.floor((sentiment / 10) * 255));
    const green = Math.min(255, Math.floor(((10 - sentiment) / 10) * 255));
    return `rgb(${red}, ${green}, 0)`;
  };

  return (
    <div className="flex flex-col items-center p-5">
      <div className="w-full bg-gray-200 p-3 text-center">
        Sentiment: {sentiment} / 10{" "}
        {comment && <span className="border p-2 rounded-md border-black">{comment}</span>}
      </div>
      <div className="w-full bg-gray-300 h-4 rounded mt-2 relative">
        <div
          className="absolute top-0 left-0 h-full rounded transition-all duration-500"
          style={{
            width: `${(sentiment / 10) * 100}%`,
            backgroundColor: getBackgroundColor(sentiment),
          }}
        ></div>
      </div>
      <textarea
        value={text}
        onChange={handleTextChange}
        placeholder="Type your text here..."
        className="w-4/5 h-48 mt-5 p-3 text-lg border border-gray-300 rounded"
      />
      {sentiment > 1 && (
        <button
          onClick={handleImproveText}
          className="mt-3 p-2 bg-blue-500 text-white rounded"
          disabled={isImproving}
        >
          {isImproving ? "Improving Text" : "Improve text"}
        </button>
      )}
    </div>
  );
}
