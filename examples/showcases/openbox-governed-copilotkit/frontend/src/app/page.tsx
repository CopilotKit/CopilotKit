"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExampleLayout } from "@/components/example-layout";
import { useGenerativeUIExamples, useExampleSuggestions } from "@/hooks";
import { withBasePath } from "@/lib/base-path";
import {
  clearOpenBoxHaltState,
  initializeOpenBoxHaltState,
  onOpenBoxSessionHalted,
} from "@/lib/openbox-halt-state";

import {
  CopilotChat,
  CopilotChatMessageView,
  CopilotChatSuggestionPill,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type {
  CopilotChatMessageViewProps,
  CopilotChatSuggestionViewProps,
} from "@copilotkit/react-core/v2";
import type { Suggestion } from "@copilotkit/core";
import { OpenBoxGovernanceDecision } from "@openbox-ai/openbox-sdk/copilotkit/react";
import { openBoxDemoScenarios } from "@/lib/openbox-demo-scenarios";
import {
  OpenBoxLiveTimingProvider,
  timingsFromLiveTiming,
  useOpenBoxLiveTimingValue,
} from "@/lib/openbox-live-timing";
import type { OpenBoxLiveTiming } from "@/lib/openbox-live-timing";

type IndexedSuggestion = {
  suggestion: Suggestion;
  index: number;
};

const openBoxTheme = {
  logoSrc: withBasePath("/openbox-mark.png"),
  accentColor: "#3B9AF5",
  radius: 8,
  density: "comfortable" as const,
  mode: "auto" as const,
};

const openBoxToolNames = new Set([
  "openbox_governed_action",
  "openbox_governed_approval_action",
  "openbox_resume_governed_action",
]);

const hasSuggestionClass = (suggestion: Suggestion, className: string) =>
  suggestion.className?.split(/\s+/).includes(className) ?? false;

const isOpenBoxWorkflowSuggestion = (suggestion: Suggestion) =>
  hasSuggestionClass(suggestion, "openbox-workflow-suggestion");

export default function HomePage() {
  const [isOpenBoxHalted, setIsOpenBoxHalted] = useState(() => {
    initializeOpenBoxHaltState();
    return false;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("reset")) {
      clearOpenBoxHaltState();
      setIsOpenBoxHalted(false);
    }

    const onHalted = () => setIsOpenBoxHalted(true);
    return onOpenBoxSessionHalted(onHalted);
  }, []);

  return <OpenBoxDemoContent isOpenBoxHalted={isOpenBoxHalted} />;
}

function OpenBoxDemoContent({ isOpenBoxHalted }: { isOpenBoxHalted: boolean }) {
  useGenerativeUIExamples();
  useExampleSuggestions();

  const input = useMemo(
    () => ({
      disclaimer: () => null,
      className: "pb-6",
      textArea: {
        disabled: isOpenBoxHalted,
        placeholder: isOpenBoxHalted
          ? "OpenBox halted this session. Start a new chat or reset."
          : "Type a message...",
      },
      sendButton: {
        disabled: isOpenBoxHalted,
      },
    }),
    [isOpenBoxHalted],
  );

  return (
    <ExampleLayout
      chatContent={
        <div className="flex min-h-0 flex-1 flex-col">
          <CopilotChat
            attachments={{ enabled: true }}
            input={input}
            messageView={OpenBoxMessageView}
            suggestionView={OpenBoxSuggestionView}
          />
        </div>
      }
      chatOverlay={<>{isOpenBoxHalted ? <OpenBoxHaltedOverlay /> : null}</>}
    />
  );
}

function OpenBoxMessageView({
  className,
  cursor,
  isRunning = false,
  messages = [],
  ...props
}: CopilotChatMessageViewProps) {
  return (
    <OpenBoxLiveTimingProvider>
      <OpenBoxMessageViewContent
        {...props}
        className={className}
        cursor={cursor}
        isRunning={isRunning}
        messages={messages}
      />
    </OpenBoxLiveTimingProvider>
  );
}

function OpenBoxMessageViewContent({
  className,
  cursor,
  isRunning = false,
  messages = [],
  ...props
}: CopilotChatMessageViewProps) {
  const liveTiming = useOpenBoxLiveTimingValue();

  return (
    <CopilotChatMessageView
      {...props}
      cursor={cursor}
      isRunning={isRunning}
      messages={messages}
    >
      {({
        interruptElement,
        isRunning: slotIsRunning,
        messageElements,
        messages: slotMessages,
      }) => {
        const lastMessage = slotMessages[slotMessages.length - 1];
        const showCursor =
          slotIsRunning && recordValue(lastMessage).role !== "reasoning";
        const showRuntimeReview =
          slotIsRunning && !hasOpenBoxToolState(slotMessages);

        return (
          <div
            data-copilotkit
            data-testid="copilot-message-list"
            className={`copilotKitMessages cpk:flex cpk:flex-col ${className ?? ""}`}
          >
            {messageElements}
            {showRuntimeReview ? (
              <OpenBoxRuntimeReview liveTiming={liveTiming} />
            ) : null}
            {interruptElement}
            {showCursor ? (
              <div className="cpk:mt-2">
                <CopilotChatMessageView.Cursor />
              </div>
            ) : null}
          </div>
        );
      }}
    </CopilotChatMessageView>
  );
}

OpenBoxMessageView.Cursor = CopilotChatMessageView.Cursor;

function OpenBoxRuntimeReview({
  liveTiming,
}: {
  liveTiming: OpenBoxLiveTiming | null;
}) {
  return (
    <OpenBoxGovernanceDecision
      status="inProgress"
      parameters={{
        action: liveTiming?.action ?? "copilotkit_runtime_gate",
        request:
          liveTiming?.request ??
          "OpenBox is reviewing this request before the assistant continues.",
        timings: liveTiming ? timingsFromLiveTiming(liveTiming) : undefined,
      }}
      theme={openBoxTheme}
      scenarios={openBoxDemoScenarios as any}
    />
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function hasOpenBoxToolState(messages: unknown[]) {
  return messages.some((message) => {
    const record = recordValue(message);
    const name = stringValue(record.name);
    if (openBoxToolNames.has(name)) return true;

    const content = stringValue(record.content);
    if (content.includes("openbox.copilotkit.result.v1")) return true;

    return toolCallsFromMessage(record).some((toolCall) =>
      openBoxToolNames.has(toolCallName(toolCall)),
    );
  });
}

function toolCallsFromMessage(message: Record<string, unknown>): unknown[] {
  if (Array.isArray(message.toolCalls)) return message.toolCalls;
  if (Array.isArray(message.tool_calls)) return message.tool_calls;
  const additionalKwargs = recordValue(message.additional_kwargs);
  if (Array.isArray(additionalKwargs.tool_calls))
    return additionalKwargs.tool_calls;
  return [];
}

function toolCallName(toolCall: unknown): string {
  const record = recordValue(toolCall);
  const fn = recordValue(record.function);
  return stringValue(record.name ?? fn.name);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const OpenBoxSuggestionView = forwardRef<
  HTMLDivElement,
  CopilotChatSuggestionViewProps
>(function OpenBoxSuggestionView(
  { suggestions, onSelectSuggestion, loadingIndexes, className },
  ref,
) {
  const isRuntimeReady = useCopilotRuntimeReady();
  const loadingSet = new Set(loadingIndexes ?? []);
  const grouped = suggestions.reduce(
    (groups, suggestion, index) => {
      const item = { suggestion, index };
      if (isOpenBoxWorkflowSuggestion(suggestion)) {
        return {
          ...groups,
          workflow: [...groups.workflow, item],
        };
      }

      return {
        ...groups,
        standard: [...groups.standard, item],
      };
    },
    {
      workflow: [] as IndexedSuggestion[],
      standard: [] as IndexedSuggestion[],
    },
  );

  const selectSuggestion: CopilotChatSuggestionViewProps["onSelectSuggestion"] =
    (suggestion, index) => {
      onSelectSuggestion?.(suggestion, index);
    };

  return (
    <div
      ref={ref}
      data-copilotkit
      data-testid="copilot-suggestions"
      className={`pointer-events-none space-y-3 ${className ?? ""}`}
    >
      {grouped.workflow.length > 0 ? (
        <div className="pointer-events-auto flex max-h-48 max-w-[38rem] flex-wrap items-center gap-2 overflow-y-auto pr-1">
          {grouped.workflow.map(({ suggestion, index }) => (
            <SuggestionButton
              key={`${suggestion.title}-${index}`}
              suggestion={suggestion}
              index={index}
              isLoading={
                !isRuntimeReady || loadingSet.has(index) || suggestion.isLoading
              }
              onSelectSuggestion={isRuntimeReady ? selectSuggestion : undefined}
              className="openbox-governed-suggestion openbox-workflow-suggestion"
            />
          ))}
        </div>
      ) : null}

      {grouped.standard.length > 0 ? (
        <SuggestionSection title="Suggestions">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {grouped.standard.map(({ suggestion, index }) => (
              <SuggestionButton
                key={`${suggestion.title}-${index}`}
                suggestion={suggestion}
                index={index}
                isLoading={
                  !isRuntimeReady ||
                  loadingSet.has(index) ||
                  suggestion.isLoading
                }
                onSelectSuggestion={
                  isRuntimeReady ? selectSuggestion : undefined
                }
              />
            ))}
          </div>
        </SuggestionSection>
      ) : null}
    </div>
  );
});

function useCopilotRuntimeReady() {
  const { copilotkit } = useCopilotKit();
  const [status, setStatus] = useState(copilotkit.runtimeConnectionStatus);

  useEffect(() => {
    setStatus(copilotkit.runtimeConnectionStatus);
    const subscription = copilotkit.subscribe({
      onRuntimeConnectionStatusChanged: ({ status: nextStatus }) => {
        setStatus(nextStatus);
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  return status === "connected";
}

function SuggestionSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pointer-events-auto rounded-md border border-[var(--border)] bg-[var(--background)]/95 px-3 py-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase text-[var(--muted-foreground)]">
          {title}
        </div>
        {action}
      </div>
      {description ? (
        <p className="mb-3 max-w-[36rem] text-xs leading-5 text-[var(--muted-foreground)]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function SuggestionButton({
  suggestion,
  index,
  isLoading,
  onSelectSuggestion,
  className,
}: {
  suggestion: Suggestion;
  index: number;
  isLoading?: boolean;
  onSelectSuggestion?: CopilotChatSuggestionViewProps["onSelectSuggestion"];
  className?: string;
}) {
  return (
    <CopilotChatSuggestionPill
      className={className ?? suggestion.className}
      isLoading={isLoading}
      type="button"
      onClick={() => onSelectSuggestion?.(suggestion, index)}
    >
      {suggestion.title}
    </CopilotChatSuggestionPill>
  );
}

function OpenBoxHaltedOverlay() {
  const reset = () => {
    clearOpenBoxHaltState();
    window.location.href = withBasePath(`/?reset=${Date.now()}`);
  };

  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-24 z-30 flex justify-center">
      <div className="pointer-events-auto w-full max-w-md rounded-md border border-orange-500/30 bg-[var(--background)]/95 px-4 py-3 text-sm text-orange-700 shadow-lg shadow-black/15 backdrop-blur">
        <div className="font-medium">OpenBox halted this session.</div>
        <div className="mt-1 text-orange-700">
          Start a new chat or reset before sending another governed request.
        </div>
        <button
          type="button"
          className="mt-3 rounded-md border border-orange-500/30 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-500/10"
          onClick={reset}
        >
          Reset demo
        </button>
      </div>
    </div>
  );
}
