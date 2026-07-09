<script lang="ts">
  import type { UserMessage } from "@ag-ui/core";
  import type { Snippet } from "svelte";
  import { IconCheck, IconCopy, IconEdit, IconChevronLeft, IconChevronRight } from "../icons";
  import { ChatConfig, getChatConfig } from "./chat-config-context.svelte";

  interface MessageRendererProps {
    message: UserMessage;
    content: string;
    isMultiline: boolean;
  }

  interface ToolbarProps {
    message: UserMessage;
    showBranchNavigation: boolean;
    hasEditAction: boolean;
  }

  interface CopyButtonProps {
    onCopy: () => Promise<void>;
    copied: boolean;
    label: string;
  }

  interface EditButtonProps {
    onEdit: () => void;
    label: string;
  }

  interface BranchNavigationProps {
    branchIndex: number;
    numberOfBranches: number;
    canGoPrev: boolean;
    canGoNext: boolean;
    goPrev: () => void;
    goNext: () => void;
  }

  interface LayoutProps {
    message: UserMessage;
    content: string;
    isMultiline: boolean;
    showBranchNavigation: boolean;
    hasEditAction: boolean;
    branchIndex: number;
    numberOfBranches: number;
    canGoPrev: boolean;
    canGoNext: boolean;
    onCopy: () => Promise<void>;
    onEdit: () => void;
    goPrev: () => void;
    goNext: () => void;
    copied: boolean;
  }

  const labels = {
    userMessageToolbarCopyMessageLabel: "Copy",
    userMessageToolbarEditMessageLabel: "Edit",
  };

  let {
    message,
    branchIndex = 0,
    numberOfBranches = 1,
    layout,
    messageRenderer,
    toolbar: toolbarSnippet,
    copyButton,
    editButton,
    branchNavigation,
    toolbarItems,
    children,
  }: {
    message: UserMessage;
    branchIndex?: number;
    numberOfBranches?: number;
    layout?: Snippet<[LayoutProps]>;
    messageRenderer?: Snippet<[MessageRendererProps]>;
    toolbar?: Snippet<[ToolbarProps]>;
    copyButton?: Snippet<[CopyButtonProps]>;
    editButton?: Snippet<[EditButtonProps]>;
    branchNavigation?: Snippet<[BranchNavigationProps]>;
    toolbarItems?: Snippet<[]>;
    children?: Snippet<[]>;
  } = $props();

  const config = getChatConfig();

  let copied = $state(false);
  let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

  function flattenUserMessageContent(content?: UserMessage["content"]): string {
    if (!content) return "";
    if (typeof content === "string") return content;
    return content
      .map((part) => {
        if (part && typeof part === "object" && "type" in part && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }

  const flattenedContent = $derived(flattenUserMessageContent(message.content));
  const isMultiline = $derived(flattenedContent.includes("\n"));

  const hasEditAction = true;
  const showBranchNavigation = $derived(numberOfBranches > 1);
  const canGoPrev = $derived(branchIndex > 0);
  const canGoNext = $derived(branchIndex < numberOfBranches - 1);

  function resetCopiedStateWithDelay() {
    if (copiedResetTimeout) clearTimeout(copiedResetTimeout);
    copied = true;
    copiedResetTimeout = setTimeout(() => {
      copied = false;
      copiedResetTimeout = null;
    }, 2000);
  }

  async function handleCopyMessage() {
    if (!flattenedContent) return;
    if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") return;
    try {
      await navigator.clipboard.writeText(flattenedContent);
      resetCopiedStateWithDelay();
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  }

  function handleEditMessage() {
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("copilotkit:edit-message", { detail: { message } }));
    }
  }

  function switchToBranch(branchIdx: number) {
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("copilotkit:switch-branch", { detail: { branchIndex: branchIdx, numberOfBranches, message } }));
    }
  }

  function goPrev() { if (canGoPrev) switchToBranch(branchIndex - 1); }
  function goNext() { if (canGoNext) switchToBranch(branchIndex + 1); }

  const toolbarBtnClass = "cpk:inline-flex cpk:h-8 cpk:w-8 cpk:items-center cpk:justify-center cpk:rounded-md cpk:p-0 cpk:cursor-pointer cpk:text-[rgb(93,93,93)] cpk:transition-colors cpk:hover:bg-[#E8E8E8] cpk:hover:text-[rgb(93,93,93)] cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030] cpk:dark:hover:text-[rgb(243,243,243)] cpk:disabled:pointer-events-none cpk:disabled:opacity-50";

  const layoutProps = $derived<LayoutProps>({
    message,
    get content() { return flattenedContent; },
    get isMultiline() { return isMultiline; },
    get showBranchNavigation() { return showBranchNavigation; },
    get hasEditAction() { return hasEditAction; },
    branchIndex,
    numberOfBranches,
    get canGoPrev() { return canGoPrev; },
    get canGoNext() { return canGoNext; },
    onCopy: handleCopyMessage,
    onEdit: handleEditMessage,
    goPrev,
    goNext,
    get copied() { return copied; },
  });
</script>

{#if layout}
  {@render layout(layoutProps)}
{:else}
  <div
    data-copilotkit
    data-testid="copilot-user-message"
    class="cpk:flex cpk:flex-col cpk:items-end cpk:group cpk:pt-10"
    data-message-id={message.id}
  >
    {#if messageRenderer}
      {@render messageRenderer({ message, content: flattenedContent, isMultiline })}
    {:else}
      <div
        class="cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%] cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:inline-block cpk:whitespace-pre-wrap"
        data-multiline={isMultiline ? "true" : undefined}
        class:cpk:py-3={isMultiline}
      >
        {flattenedContent}
      </div>
    {/if}

    {#if toolbarSnippet}
      {@render toolbarSnippet({ message, showBranchNavigation, hasEditAction })}
    {:else}
      <div class="cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:-mr-[5px] cpk:mt-[4px] cpk:invisible cpk:group-hover:visible">
        <div class="cpk:flex cpk:items-center cpk:gap-1 cpk:justify-end">
          {#if toolbarItems}{@render toolbarItems()}{/if}

          {#if copyButton}
            {@render copyButton({ onCopy: handleCopyMessage, copied, label: labels.userMessageToolbarCopyMessageLabel })}
          {:else}
            <button
              data-testid="copilot-user-copy-button"
              type="button"
              class={toolbarBtnClass}
              aria-label={labels.userMessageToolbarCopyMessageLabel}
              title={labels.userMessageToolbarCopyMessageLabel}
              onclick={handleCopyMessage}
            >
              {#if copied}
                <IconCheck class="cpk:size-[18px]" />
              {:else}
                <IconCopy class="cpk:size-[18px]" />
              {/if}
            </button>
          {/if}

          {#if hasEditAction}
            {#if editButton}
              {@render editButton({ onEdit: handleEditMessage, label: labels.userMessageToolbarEditMessageLabel })}
            {:else}
              <button
                type="button"
                class={toolbarBtnClass}
                aria-label={labels.userMessageToolbarEditMessageLabel}
                title={labels.userMessageToolbarEditMessageLabel}
                onclick={handleEditMessage}
              >
                <IconEdit class="cpk:size-[18px]" />
              </button>
            {/if}
          {/if}

          {#if showBranchNavigation}
            {#if branchNavigation}
              {@render branchNavigation({ branchIndex, numberOfBranches, canGoPrev, canGoNext, goPrev, goNext })}
            {:else}
              <div class="cpk:flex cpk:items-center cpk:gap-1">
                <button
                  type="button"
                  class="{toolbarBtnClass} cpk:h-6 cpk:w-6 cpk:p-0"
                  disabled={!canGoPrev}
                  aria-label="Previous branch"
                  title="Previous branch"
                  onclick={goPrev}
                >
                  <IconChevronLeft class="cpk:size-[20px]" />
                </button>
                <span class="cpk:text-sm cpk:text-muted-foreground cpk:px-0 cpk:font-medium">
                  {branchIndex + 1}/{numberOfBranches}
                </span>
                <button
                  type="button"
                  class="{toolbarBtnClass} cpk:h-6 cpk:w-6 cpk:p-0"
                  disabled={!canGoNext}
                  aria-label="Next branch"
                  title="Next branch"
                  onclick={goNext}
                >
                  <IconChevronRight class="cpk:size-[20px]" />
                </button>
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
