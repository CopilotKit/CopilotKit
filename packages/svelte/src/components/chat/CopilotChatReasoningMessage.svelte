<script lang="ts">
  import type { Message, ReasoningMessage } from "@ag-ui/core";
  import type { Snippet } from "svelte";
  import { IconChevronRight } from "../icons";
  import StreamMarkdown from "./StreamMarkdown.svelte";

  interface HeaderSlotProps {
    isOpen: boolean;
    label: string;
    hasContent: boolean;
    isStreaming: boolean;
    onClick?: () => void;
  }

  interface ContentViewSlotProps {
    isStreaming: boolean;
    hasContent: boolean;
    content: string;
  }

  interface ToggleSlotProps {
    isOpen: boolean;
    contentView: ContentViewSlotProps;
  }

  interface LayoutSlotProps {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
    header: HeaderSlotProps;
    contentView: ContentViewSlotProps;
    toggle: ToggleSlotProps;
  }

  let {
    message,
    messages = [] as Message[],
    isRunning = false,
    header,
    contentView,
    toggle,
    layout,
    children,
  }: {
    message: ReasoningMessage;
    messages?: Message[];
    isRunning?: boolean;
    header?: Snippet<[HeaderSlotProps]>;
    contentView?: Snippet<[ContentViewSlotProps]>;
    toggle?: Snippet<[ToggleSlotProps]>;
    layout?: Snippet<[LayoutSlotProps]>;
    children?: Snippet<[]>;
  } = $props();

  function formatDuration(seconds: number): string {
    if (seconds < 1) return "a few seconds";
    if (seconds < 60) return `${Math.round(seconds)} seconds`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (secs === 0) return `${mins} minute${mins > 1 ? "s" : ""}`;
    return `${mins}m ${secs}s`;
  }

  const normalizedContent = $derived(
    typeof message.content === "string" ? message.content : "",
  );
  const hasContent = $derived(normalizedContent.length > 0);
  const isLatest = $derived(
    messages[messages.length - 1]?.id === message.id,
  );
  const isStreaming = $derived(!!(isRunning && isLatest));

  let elapsed = $state(0);
  let isOpen = $state(false);
  let userToggledDuringStreaming = $state(false);
  let startTimeMs: number | null = null;
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;

  function clearElapsedInterval() {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  function updateElapsedNow() {
    if (startTimeMs !== null) {
      elapsed = (Date.now() - startTimeMs) / 1000;
    }
  }

  $effect(() => {
    if (isStreaming) {
      if (startTimeMs === null) {
        startTimeMs = Date.now();
      }
      clearElapsedInterval();
      elapsedInterval = setInterval(updateElapsedNow, 1000);
      userToggledDuringStreaming = false;
      isOpen = true;
    } else {
      clearElapsedInterval();
      updateElapsedNow();
      if (!userToggledDuringStreaming) {
        isOpen = false;
      }
    }

    return () => {
      clearElapsedInterval();
    };
  });

  const label = $derived(
    isStreaming
      ? "Thinking\u2026"
      : `Thought for ${formatDuration(elapsed)}`,
  );

  function toggleOpen() {
    if (!hasContent) return;
    userToggledDuringStreaming = true;
    isOpen = !isOpen;
  }

  const headerProps = $derived<HeaderSlotProps>({
    get isOpen() { return isOpen; },
    get label() { return label; },
    get hasContent() { return hasContent; },
    get isStreaming() { return isStreaming; },
    get onClick() { return hasContent ? toggleOpen : undefined; },
  });

  const contentViewProps = $derived<ContentViewSlotProps>({
    get isStreaming() { return isStreaming; },
    get hasContent() { return hasContent; },
    get content() { return normalizedContent; },
  });

  const toggleProps = $derived<ToggleSlotProps>({
    get isOpen() { return isOpen; },
    get contentView() { return contentViewProps; },
  });
</script>

<div data-copilotkit class="cpk:my-1" data-message-id={message.id}>
  {#if layout}
    {@render layout({
      message,
      messages,
      isRunning,
      header: headerProps,
      contentView: contentViewProps,
      toggle: toggleProps,
    })}
  {:else}
    {#if header}
      {@render header(headerProps)}
    {:else}
      <button
        type="button"
        class="cpk:inline-flex cpk:items-center cpk:gap-1 cpk:py-1 cpk:text-sm cpk:text-muted-foreground cpk:transition-colors cpk:select-none"
        class:cpk:hover:text-foreground={hasContent}
        class:cpk:cursor-pointer={hasContent}
        class:cpk:cursor-default={!hasContent}
        aria-expanded={hasContent ? isOpen : undefined}
        onclick={hasContent ? toggleOpen : undefined}
      >
        <span class="cpk:font-medium">{label}</span>
        {#if isStreaming && !hasContent}
          <span class="cpk:inline-flex cpk:items-center cpk:ml-1">
            <span class="cpk:w-1.5 cpk:h-1.5 cpk:rounded-full cpk:bg-muted-foreground cpk:animate-pulse"></span>
          </span>
        {/if}
        {#if hasContent}
          <IconChevronRight
            class={"cpk:size-3.5 cpk:shrink-0 cpk:transition-transform cpk:duration-200" + (isOpen ? " cpk:rotate-90" : "")}
          />
        {/if}
      </button>
    {/if}

    {#if toggle}
      {@render toggle(toggleProps)}
    {:else}
      <div
        class="cpk:grid cpk:transition-[grid-template-rows] cpk:duration-200 cpk:ease-in-out"
        style="grid-template-rows: {isOpen ? '1fr' : '0fr'}"
      >
        <div class="cpk:overflow-hidden">
          {#if contentView}
            {@render contentView(contentViewProps)}
          {:else}
            {#if hasContent || isStreaming}
              <div class="cpk:pb-2 cpk:pt-1">
                <div class="cpk:text-sm cpk:text-muted-foreground">
                  <StreamMarkdown content={normalizedContent} />
                  {#if isStreaming && hasContent}
                    <span class="cpk:inline-flex cpk:items-center cpk:ml-1 cpk:align-middle">
                      <span class="cpk:w-2 cpk:h-2 cpk:rounded-full cpk:bg-muted-foreground cpk:animate-pulse"></span>
                    </span>
                  {/if}
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
