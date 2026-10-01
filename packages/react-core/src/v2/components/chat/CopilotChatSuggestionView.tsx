import React from "react";
import type { Suggestion } from "@copilotkit/core";
import type { WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import { cn } from "../../lib/utils";
import type { CopilotChatSuggestionPillProps } from "./CopilotChatSuggestionPill";
import CopilotChatSuggestionPill from "./CopilotChatSuggestionPill";

// Pills: a single scrollable row whose right edge fades when pills overflow.
const rowClasses = [
  "cpk:flex cpk:flex-nowrap cpk:items-center cpk:gap-2 cpk:overflow-x-auto cpk:py-1",
  "cpk:[scrollbar-width:none] cpk:[&::-webkit-scrollbar]:hidden",
  "cpk:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
];
// Cards: two columns at every width, so cards stay close to square in narrow
// chats (popup, sidebar) too. `auto-rows-fr` gives every card the same height.
const gridClasses =
  "cpk:grid cpk:w-full cpk:auto-rows-fr cpk:grid-cols-2 cpk:gap-2";

const DefaultContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { "data-appearance"?: string }
>(function DefaultContainer({ className, ...props }, ref) {
  const cards = props["data-appearance"] === "cards";
  return (
    <div
      ref={ref}
      data-copilotkit
      data-testid="copilot-suggestions"
      className={cn(
        cards ? gridClasses : rowClasses,
        "cpk:pointer-events-auto",
        className,
      )}
      {...props}
    />
  );
});

export type CopilotChatSuggestionViewProps = WithSlots<
  {
    container: typeof DefaultContainer;
    suggestion: typeof CopilotChatSuggestionPill;
  },
  {
    suggestions: Suggestion[];
    onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
    loadingIndexes?: ReadonlyArray<number>;
    /**
     * `"pills"` (default): compact chips in a single scrollable row.
     * `"cards"`: a grid of cards, each with the suggestion's title as header
     * and its message as body. Welcome screens use cards.
     */
    appearance?: "pills" | "cards";
  } & React.HTMLAttributes<HTMLDivElement>
>;

export const CopilotChatSuggestionView = React.forwardRef<
  HTMLDivElement,
  CopilotChatSuggestionViewProps
>(function CopilotChatSuggestionView(
  {
    suggestions,
    onSelectSuggestion,
    loadingIndexes,
    appearance = "pills",
    container,
    suggestion: suggestionSlot,
    className,
    children,
    ...restProps
  },
  ref,
) {
  const loadingSet = React.useMemo(() => {
    if (!loadingIndexes || loadingIndexes.length === 0) {
      return new Set<number>();
    }
    return new Set(loadingIndexes);
  }, [loadingIndexes]);

  const ContainerElement = renderSlot(container, DefaultContainer, {
    ref,
    className,
    "data-appearance": appearance,
    ...restProps,
  });

  const cardProps = (suggestion: Suggestion) =>
    appearance === "cards"
      ? {
          appearance: "card" as const,
          description:
            suggestion.message && suggestion.message !== suggestion.title
              ? suggestion.message
              : undefined,
        }
      : {};

  const suggestionElements = suggestions.map((suggestion, index) => {
    const isLoading = loadingSet.has(index) || suggestion.isLoading === true;
    const pill = renderSlot<
      typeof CopilotChatSuggestionPill,
      CopilotChatSuggestionPillProps
    >(suggestionSlot, CopilotChatSuggestionPill, {
      children: suggestion.title,
      className: suggestion.className,
      ...cardProps(suggestion),
      isLoading,
      type: "button",
      onClick: () => onSelectSuggestion?.(suggestion, index),
    });

    return React.cloneElement(pill, {
      key: `${suggestion.title}-${index}`,
    });
  });

  const boundContainer = React.cloneElement(
    ContainerElement,
    undefined,
    suggestionElements,
  );

  if (typeof children === "function") {
    const sampleSuggestion = renderSlot<
      typeof CopilotChatSuggestionPill,
      CopilotChatSuggestionPillProps
    >(suggestionSlot, CopilotChatSuggestionPill, {
      children: suggestions[0]?.title ?? "",
      ...(suggestions[0] ? cardProps(suggestions[0]) : {}),
      isLoading:
        suggestions.length > 0
          ? loadingSet.has(0) || suggestions[0]?.isLoading === true
          : false,
      type: "button",
    });

    return (
      <div data-copilotkit style={{ display: "contents" }}>
        {children({
          container: boundContainer,
          suggestion: sampleSuggestion,
          suggestions,
          onSelectSuggestion,
          loadingIndexes,
          className,
          ...restProps,
        })}
      </div>
    );
  }

  if (children) {
    return (
      <div data-copilotkit style={{ display: "contents" }}>
        {boundContainer}
        {children}
      </div>
    );
  }

  return boundContainer;
});

CopilotChatSuggestionView.displayName = "CopilotChatSuggestionView";

export default CopilotChatSuggestionView;
