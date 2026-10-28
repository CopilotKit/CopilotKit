"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface TailoredContentOptionProps {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * One path in a `<TailoredContent>`. It renders nothing itself: the parent
 * reads its props and shows the chosen option's children.
 */
export function TailoredContentOption(_props: TailoredContentOptionProps) {
  return null;
}

/**
 * "Pick your path" choice cards (shell-docs' `<TailoredContent>`): the
 * reader picks an option and only its content shows. The pick lives in the
 * URL (`?<id>=<option>`) so a link opens the same path; the first render is
 * the default, so the page's HTML always carries content.
 */
export function TailoredContent({
  id,
  children,
  header,
  className,
  defaultOptionIndex = 0,
}: {
  id: string;
  children?: ReactNode;
  header?: ReactNode;
  className?: string;
  defaultOptionIndex?: number;
}) {
  const options = Children.toArray(children).filter(
    (child): child is ReactElement<TailoredContentOptionProps> =>
      isValidElement<TailoredContentOptionProps>(child) &&
      typeof child.props.id === "string",
  );
  const ids = options.map((o) => o.props.id);
  const fallback =
    ids[Math.min(Math.max(0, defaultOptionIndex), ids.length - 1)];
  const [selected, setSelected] = useState(fallback);

  // Follow the URL: on arrival and on back/forward.
  useEffect(() => {
    const read = () => {
      const fromUrl = new URLSearchParams(window.location.search).get(id);
      setSelected(fromUrl && ids.includes(fromUrl) ? fromUrl : fallback);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
    // `ids` is derived from children; its joined value is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fallback, ids.join("\n")]);

  if (options.length === 0) return null;

  function choose(value: string) {
    setSelected(value);
    const url = new URL(window.location.href);
    url.searchParams.set(id, value);
    window.history.pushState(null, "", url);
  }

  const chosen = options.find((o) => o.props.id === selected) ?? options[0];

  return (
    <div className={cn("my-6", className)}>
      {header}
      <RadioGroup
        value={chosen.props.id}
        onValueChange={(value) => choose(String(value))}
        aria-label="Choose a path"
        className={cn(
          "not-prose mb-6 grid gap-3",
          options.length > 1 && "md:grid-flow-col md:auto-cols-fr",
        )}
      >
        {options.map((option) => {
          const inputId = `tailored-${id}-${option.props.id}`;
          return (
            <FieldLabel key={option.props.id} htmlFor={inputId}>
              <Field orientation="horizontal" className="items-start">
                <FieldContent>
                  <FieldTitle className="flex items-center gap-2 text-base font-semibold [&_svg]:size-4 [&_svg]:shrink-0">
                    {option.props.icon}
                    {option.props.title}
                  </FieldTitle>
                  {option.props.description ? (
                    <FieldDescription>{option.props.description}</FieldDescription>
                  ) : null}
                </FieldContent>
                <RadioGroupItem value={option.props.id} id={inputId} />
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>
      <div role="region" aria-label={chosen.props.title}>
        {chosen.props.children}
      </div>
    </div>
  );
}
