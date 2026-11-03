"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import {
  backendById,
  frontendById,
  type FrontendId,
  type Stack,
} from "@/lib/stack";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "fumadocs-ui/components/ui/popover";
import { useStack } from "./stack-provider";
import { StackSelect } from "./stack-select";

interface VariantProps {
  frontend?: FrontendId;
  backend?: string;
  children: ReactNode;
}

/** One stack's version of a block. Omit an axis to match any value on it. */
export function Variant({ children }: VariantProps) {
  return <>{children}</>;
}

function matches(props: VariantProps, stack: Stack): number {
  if (props.frontend && props.frontend !== stack.frontend) return -1;
  if (props.backend && props.backend !== stack.backend) return -1;
  return (props.frontend ? 1 : 0) + (props.backend ? 1 : 0);
}

function VariantLabel({ frontend, backend }: Omit<VariantProps, "children">) {
  if (!frontend && !backend) {
    return <span className="font-medium text-fd-foreground">any stack</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-fd-foreground">
      {frontend ? (
        <>
          <FrontendLogo icon={frontend} size={13} />
          {frontendById(frontend)?.name}
        </>
      ) : null}
      {frontend && backend ? (
        <span className="text-fd-muted-foreground">·</span>
      ) : null}
      {backend ? (
        <>
          <FrameworkLogo slug={backend} size={13} />
          {backendById(backend)?.name}
        </>
      ) : null}
    </span>
  );
}

/** Below md the sidebar is a drawer, so each block carries its own switch. */
function MobileChange() {
  return (
    <Popover>
      <PopoverTrigger className="rounded-md font-medium text-fd-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none md:hidden">
        Change
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(18rem,calc(100vw-2rem))] p-2"
      >
        <StackSelect />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Renders the <Variant> that best matches the reader's stack, labelled with
 * what it is for. When the stack changes and this block's content changes
 * with it, the label says so; when no variant fits, it says what it shows
 * instead.
 */
export function StackVariants({ children }: { children: ReactNode }) {
  const { stack, revision, registerBlock } = useStack();
  const variants = Children.toArray(children).filter(
    (child): child is ReactElement<VariantProps> => isValidElement(child),
  );

  useEffect(registerBlock, [registerBlock]);

  let chosen = 0;
  let exact = false;
  if (stack) {
    let best = -1;
    variants.forEach((v, i) => {
      const score = matches(v.props, stack);
      if (score > best) {
        best = score;
        chosen = i;
      }
    });
    exact = best >= 0;
  }

  const [updated, setUpdated] = useState(false);
  const shown = useRef<{ index: number; revision: number } | null>(null);
  useEffect(() => {
    const prev = shown.current;
    shown.current = { index: chosen, revision };
    if (prev && prev.revision !== revision && prev.index !== chosen) {
      setUpdated(true);
      const t = setTimeout(() => setUpdated(false), 2400);
      return () => clearTimeout(t);
    }
  }, [chosen, revision]);

  const variant = variants[chosen];
  if (!variant) return null;
  let note: string | null = null;
  if (!stack) note = "Example. Choose your stack in the sidebar to tailor it.";
  else if (!exact) {
    // Name only the axes this block varies on.
    const missing = [
      variants.some((v) => v.props.frontend) &&
        frontendById(stack.frontend)?.name,
      variants.some((v) => v.props.backend) && backendById(stack.backend)?.name,
    ]
      .filter(Boolean)
      .join(" · ");
    note = `No ${missing} version yet.`;
  }

  return (
    <div className="flex flex-col gap-2" data-stack-variants="">
      <div className="not-prose flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fd-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          For
          <VariantLabel
            frontend={variant.props.frontend}
            backend={variant.props.backend}
          />
        </span>
        {note ? <span>{note}</span> : null}
        <MobileChange />
        <span
          aria-live="polite"
          className={cn(
            "rounded-full bg-fd-primary/10 px-2 py-0.5 font-medium text-fd-primary transition-opacity duration-300 motion-reduce:transition-none",
            updated ? "opacity-100" : "opacity-0",
          )}
        >
          {updated ? "Updated" : ""}
        </span>
      </div>
      <div className="prose-no-margin">{variant}</div>
    </div>
  );
}
