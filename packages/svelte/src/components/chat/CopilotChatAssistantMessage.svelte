<script lang="ts">
  import type { AssistantMessage, Message } from "@ag-ui/core";
  import type { Snippet } from "svelte";
  import { IconCheck, IconCopy, IconThumbsUp, IconThumbsDown, IconVolume2, IconRefreshCw } from "../icons";
  import { getChatConfig } from "./chat-config-context.svelte";
  import StreamMarkdown from "./StreamMarkdown.svelte";
  import CopilotChatToolCallsView from "./CopilotChatToolCallsView.svelte";

  interface MessageRendererProps {
    message: AssistantMessage;
    content: string;
  }

  interface ToolbarProps {
    message: AssistantMessage;
    shouldShowToolbar: boolean;
  }

  interface CopyButtonProps {
    onCopy: () => Promise<void>;
    copied: boolean;
    label: string;
  }

  interface ThumbsUpButtonProps {
    onThumbsUp: () => void;
    label: string;
  }

  interface ThumbsDownButtonProps {
    onThumbsDown: () => void;
    label: string;
  }

  interface ReadAloudButtonProps {
    onReadAloud: () => void;
    label: string;
  }

  interface RegenerateButtonProps {
    onRegenerate: () => void;
    label: string;
  }

  interface ToolCallsViewProps {
    message: AssistantMessage;
    messages: Message[];
  }

  interface LayoutProps {
    message: AssistantMessage;
    content: string;
    isRunning: boolean;
    toolbarVisible: boolean;
    shouldShowToolbar: boolean;
    messageRenderer: unknown;
    toolbar: unknown;
    copyButton: unknown;
    thumbsUpButton: unknown;
    thumbsDownButton: unknown;
    readAloudButton: unknown;
    regenerateButton: unknown;
    toolCallsView: unknown;
    onCopy: () => Promise<void>;
    onThumbsUp: () => void;
    onThumbsDown: () => void;
    onReadAloud: () => void;
    onRegenerate: () => void;
  }

  const defaultLabels = {
    assistantMessageToolbarCopyMessageLabel: "Copy",
    assistantMessageToolbarThumbsUpLabel: "Good response",
    assistantMessageToolbarThumbsDownLabel: "Bad response",
    assistantMessageToolbarReadAloudLabel: "Read aloud",
    assistantMessageToolbarRegenerateLabel: "Regenerate",
  };

  let {
    message,
    messages = [] as Message[],
    isRunning = false,
    toolbarVisible = true,
    layout,
    messageRenderer,
    toolbar: toolbarSnippet,
    copyButton,
    thumbsUpButton,
    thumbsDownButton,
    readAloudButton,
    regenerateButton,
    toolCallsView,
    toolbarItems,
    onThumbsUp,
    onThumbsDown,
    onReadAloud,
    onRegenerate,
    children,
  }: {
    message: AssistantMessage;
    messages?: Message[];
    isRunning?: boolean;
    toolbarVisible?: boolean;
    layout?: Snippet<[LayoutProps]>;
    messageRenderer?: Snippet<[MessageRendererProps]>;
    toolbar?: Snippet<[ToolbarProps]>;
    copyButton?: Snippet<[CopyButtonProps]>;
    thumbsUpButton?: Snippet<[ThumbsUpButtonProps]>;
    thumbsDownButton?: Snippet<[ThumbsDownButtonProps]>;
    readAloudButton?: Snippet<[ReadAloudButtonProps]>;
    regenerateButton?: Snippet<[RegenerateButtonProps]>;
    toolCallsView?: Snippet<[ToolCallsViewProps]>;
    toolbarItems?: Snippet<[]>;
    children?: Snippet<[]>;
    onThumbsUp?: (message: AssistantMessage) => void;
    onThumbsDown?: (message: AssistantMessage) => void;
    onReadAloud?: (message: AssistantMessage) => void;
    onRegenerate?: (message: AssistantMessage) => void;
  } = $props();

  let copied = $state(false);
  let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

  const config = getChatConfig();
  const labels = config?.labels ?? defaultLabels;

  function normalizeContent(content: unknown): string {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part && typeof part === "object" && "type" in part && part.type === "text" && typeof part.text === "string") {
            return part.text;
          }
          return "";
        })
        .filter((text) => text.length > 0)
        .join("\n");
    }
    return "";
  }

  const normalizedContent = $derived(normalizeContent(message.content));
  const hasContent = $derived(normalizedContent.trim().length > 0);
  const isLatestAssistantMessage = $derived(
    messages.filter((m) => m.role === "assistant").at(-1)?.id === message.id
  );
  const shouldShowToolbar = $derived(toolbarVisible && hasContent && !(isRunning && isLatestAssistantMessage));

  function resetCopiedStateWithDelay() {
    if (copiedResetTimeout) clearTimeout(copiedResetTimeout);
    copied = true;
    copiedResetTimeout = setTimeout(() => {
      copied = false;
      copiedResetTimeout = null;
    }, 2000);
  }

  async function handleCopyMessage() {
    if (!normalizedContent) return;
    if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") return;
    try {
      await navigator.clipboard.writeText(normalizedContent);
      resetCopiedStateWithDelay();
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  }

  function handleThumbsUp() { onThumbsUp?.(message); }
  function handleThumbsDown() { onThumbsDown?.(message); }
  function handleReadAloud() { onReadAloud?.(message); }
  function handleRegenerate() { onRegenerate?.(message); }

  const toolbarBtnClass = "cpk:inline-flex cpk:h-8 cpk:w-8 cpk:items-center cpk:justify-center cpk:rounded-md cpk:p-0 cpk:cursor-pointer cpk:text-[rgb(93,93,93)] cpk:transition-colors cpk:hover:bg-[#E8E8E8] cpk:hover:text-[rgb(93,93,93)] cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030] cpk:dark:hover:text-[rgb(243,243,243)] cpk:disabled:pointer-events-none cpk:disabled:opacity-50";
</script>

<div
  data-copilotkit
  data-testid="copilot-assistant-message"
  class="cpk:flex cpk:flex-col cpk:items-start cpk:w-full cpk:group cpk:pt-10"
  data-message-id={message.id}
>
  <div class="cpk:prose cpk:max-w-full cpk:break-words cpk:dark:prose-invert">
    {#if messageRenderer}
      {@render messageRenderer({ message, content: normalizedContent })}
    {:else}
      {#if hasContent}
        <StreamMarkdown content={normalizedContent} />
      {/if}
    {/if}
  </div>

  {#if toolCallsView}
    {@render toolCallsView({ message, messages })}
  {:else}
    <CopilotChatToolCallsView {message} {messages} />
  {/if}

  {#if shouldShowToolbar}
    {#if toolbarSnippet}
      {@render toolbarSnippet({ message, shouldShowToolbar })}
    {:else}
      <div class="cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:-ml-[5px] cpk:-mt-[0px]">
        <div class="cpk:flex cpk:items-center cpk:gap-1">
          {#if copyButton}
            {@render copyButton({ onCopy: handleCopyMessage, copied, label: labels.assistantMessageToolbarCopyMessageLabel as string })}
          {:else}
            <button
              data-testid="copilot-copy-button"
              type="button"
              class={toolbarBtnClass}
              aria-label={labels.assistantMessageToolbarCopyMessageLabel as string}
              title={labels.assistantMessageToolbarCopyMessageLabel as string}
              onclick={handleCopyMessage}
            >
              {#if copied}
                <IconCheck class="cpk:size-[18px]" />
              {:else}
                <IconCopy class="cpk:size-[18px]" />
              {/if}
            </button>
          {/if}

          {#if onThumbsUp}
            {#if thumbsUpButton}
              {@render thumbsUpButton({ onThumbsUp: handleThumbsUp, label: labels.assistantMessageToolbarThumbsUpLabel as string })}
            {:else}
              <button
                type="button"
                class={toolbarBtnClass}
                aria-label={labels.assistantMessageToolbarThumbsUpLabel as string}
                title={labels.assistantMessageToolbarThumbsUpLabel as string}
                onclick={handleThumbsUp}
              >
                <IconThumbsUp class="cpk:size-[18px]" />
              </button>
            {/if}
          {/if}

          {#if onThumbsDown}
            {#if thumbsDownButton}
              {@render thumbsDownButton({ onThumbsDown: handleThumbsDown, label: labels.assistantMessageToolbarThumbsDownLabel as string })}
            {:else}
              <button
                type="button"
                class={toolbarBtnClass}
                aria-label={labels.assistantMessageToolbarThumbsDownLabel as string}
                title={labels.assistantMessageToolbarThumbsDownLabel as string}
                onclick={handleThumbsDown}
              >
                <IconThumbsDown class="cpk:size-[18px]" />
              </button>
            {/if}
          {/if}

          {#if onReadAloud}
            {#if readAloudButton}
              {@render readAloudButton({ onReadAloud: handleReadAloud, label: labels.assistantMessageToolbarReadAloudLabel as string })}
            {:else}
              <button
                type="button"
                class={toolbarBtnClass}
                aria-label={labels.assistantMessageToolbarReadAloudLabel as string}
                title={labels.assistantMessageToolbarReadAloudLabel as string}
                onclick={handleReadAloud}
              >
                <IconVolume2 class="cpk:size-[20px]" />
              </button>
            {/if}
          {/if}

          {#if onRegenerate}
            {#if regenerateButton}
              {@render regenerateButton({ onRegenerate: handleRegenerate, label: labels.assistantMessageToolbarRegenerateLabel as string })}
            {:else}
              <button
                type="button"
                class={toolbarBtnClass}
                aria-label={labels.assistantMessageToolbarRegenerateLabel as string}
                title={labels.assistantMessageToolbarRegenerateLabel as string}
                onclick={handleRegenerate}
              >
                <IconRefreshCw class="cpk:size-[18px]" />
              </button>
            {/if}
          {/if}

          {#if toolbarItems}{@render toolbarItems()}{/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
