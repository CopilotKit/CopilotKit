"use client";

import * as React from "react";
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowDownIcon } from "lucide-react";

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-none",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-8", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  onClick,
  render: _render,
  variant = "secondary",
  size = "icon-sm",
  behavior = "smooth",
  tabIndex,
  type = "button",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  void _render;

  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const controls = useMessageScroller();
  const isActive = useNativeScrollButtonActive(buttonRef, direction);

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);

      if (event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      event.currentTarget.blur();

      if (direction === "end") {
        controls.scrollToEnd({ behavior });
      } else {
        controls.scrollToStart({ behavior });
      }

      const viewport = event.currentTarget
        .closest<HTMLElement>('[data-slot="message-scroller"]')
        ?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');

      if (!viewport) {
        return;
      }

      scrollViewportToEdge(viewport, direction, behavior);
      window.requestAnimationFrame(() =>
        scrollViewportToEdge(viewport, direction, "auto"),
      );
    },
    [behavior, controls, direction, onClick],
  );

  return (
    <Button
      ref={buttonRef}
      data-slot="message-scroller-button"
      data-active={isActive ? "true" : "false"}
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      aria-hidden={!isActive}
      tabIndex={isActive ? tabIndex : -1}
      type={type}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
        className,
      )}
      variant={variant}
      size={size}
      onClick={handleClick}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </Button>
  );
}

function useNativeScrollButtonActive(
  buttonRef: React.RefObject<HTMLButtonElement | null>,
  direction: "start" | "end",
) {
  const [isActive, setIsActive] = React.useState(false);

  React.useLayoutEffect(() => {
    const button = buttonRef.current;
    const viewport = button
      ?.closest<HTMLElement>('[data-slot="message-scroller"]')
      ?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');

    if (!viewport) {
      setIsActive(false);
      return;
    }

    const scrollViewport = viewport;
    const content = scrollViewport.querySelector<HTMLElement>(
      '[data-slot="message-scroller-content"]',
    );
    let frame: number | null = null;

    function readActiveState() {
      if (direction === "start") {
        return scrollViewport.scrollTop > 8;
      }

      return (
        scrollViewport.scrollHeight -
          scrollViewport.scrollTop -
          scrollViewport.clientHeight >
        8
      );
    }

    function updateActiveState() {
      frame = null;
      setIsActive(readActiveState());
    }

    function scheduleUpdate() {
      if (frame !== null) {
        return;
      }

      frame = window.requestAnimationFrame(updateActiveState);
    }

    updateActiveState();
    scrollViewport.addEventListener("scroll", scheduleUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(scrollViewport);

    if (content) {
      resizeObserver?.observe(content);
    }

    const mutationObserver =
      content && typeof MutationObserver !== "undefined"
        ? new MutationObserver(scheduleUpdate)
        : null;
    mutationObserver?.observe(content!, {
      childList: true,
      subtree: true,
    });

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      scrollViewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [buttonRef, direction]);

  return isActive;
}

function scrollViewportToEdge(
  viewport: HTMLElement,
  direction: "start" | "end",
  behavior: ScrollBehavior,
) {
  const top = direction === "end" ? viewport.scrollHeight : 0;

  if (behavior === "smooth") {
    viewport.scrollTo({ top, behavior });
    return;
  }

  viewport.scrollTop = top;
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
