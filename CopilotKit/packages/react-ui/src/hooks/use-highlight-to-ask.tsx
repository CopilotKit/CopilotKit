import { useCopilotChat } from "@copilotkit/react-core";
import { useEffect, useRef, useState } from "react";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";

export function useHighlightToAsk() {
  const { appendMessage } = useCopilotChat();

  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [highlightedText, setHighlightedText] = useState("");

  const createTooltipElement = () => {
    if (typeof window !== "undefined") {
      const tooltip = document.createElement("div");
      tooltip.style.position = "absolute";
      tooltip.style.backgroundColor = "#333";
      tooltip.style.color = "#fff";
      tooltip.style.padding = "5px";
      tooltip.style.borderRadius = "5px";
      tooltip.style.display = "none";
      tooltip.style.zIndex = "1000";
      tooltip.style.cursor = "pointer";
      tooltipRef.current = tooltip;
      document.body.appendChild(tooltip);
    }
  };

  function displayTooltip(text: string) {
    if (!!tooltipRef.current) {
      tooltipRef.current.textContent = "Ask AI";
      tooltipRef.current.style.top = `${tooltipPosition.top}px`;
      tooltipRef.current.style.left = `${tooltipPosition.left}px`;
      if (!!text) {
        tooltipRef.current.onclick = () => {
          appendMessage(
            new TextMessage({
              content: `Hi, I want to understand what '${text}' means here. Thanks :)`,
              role: Role.User,
            }),
          );
        };
      }
      tooltipRef.current.style.display = !!text ? "block" : "none";
    }
  }

  function removeHighlightedText() {
    if (typeof window !== "undefined") {
      document.getSelection()?.collapseToEnd();
    }
    setHighlightedText("");
  }

  function readHighlightedText() {
    let text = "";
    if (typeof window !== "undefined") {
      text = document.getSelection()?.toString() || "";
      if (text) {
        const selection = document.getSelection();
        const range = selection?.getRangeAt(0).cloneRange();
        const rect = range?.getBoundingClientRect();
        if (rect) {
          setTooltipPosition({
            top: rect.bottom + window.scrollY,
            left: rect.right + window.scrollX,
          });
        }
      } else {
        removeHighlightedText();
      }
    }
    setHighlightedText(text);
  }

  function listenToHighlightedText() {
    if (typeof window !== "undefined") document.addEventListener("mouseup", readHighlightedText);
  }

  useEffect(() => {
    createTooltipElement();
    listenToHighlightedText();
  }, []);

  useEffect(() => {
    displayTooltip(highlightedText);
  }, [highlightedText]);
}
