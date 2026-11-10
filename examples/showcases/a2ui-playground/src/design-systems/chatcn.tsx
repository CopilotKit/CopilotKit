"use client";

/**
 * ChatCN: the catalog drawn with shadcn/ui, the primitives ChatCN's registry builds on. Each component
 * here takes the same props the standard (or playground) component of that name takes. Only leaves are
 * swapped: a container (Card, Section) keeps its own implementation and picks up shadcn's palette from
 * the theme, so switching never remounts what is inside it (typed values, a table's sort, a tab).
 */
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { asArray } from "@/a2ui/catalog/renderers/format";
import type { RendererMap } from "@/a2ui/catalog/renderers/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  str,
  trendOf,
  useButton,
  valueText,
  type StandardProps,
} from "./shared";

function ShadcnCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex w-full min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TrendBadge({ delta, trend }: { delta?: string; trend?: string }) {
  if (!delta) return null;
  const t = trendOf(delta, trend);
  const Icon =
    t === "down" ? ArrowDownRight : t === "flat" ? Minus : ArrowUpRight;
  return (
    <Badge variant="outline" className="tabular-nums">
      <Icon />
      {delta}
    </Badge>
  );
}

function ChatcnBadge(p: StandardProps) {
  const aria = useGenerativeUIAccessibility();
  return (
    <Badge
      {...aria}
      variant={
        p.color === "danger"
          ? "destructive"
          : p.variant === "solid"
            ? "default"
            : p.variant === "outline"
              ? "outline"
              : "secondary"
      }
    >
      {str(p.label)}
    </Badge>
  );
}

function ChatcnButton(p: StandardProps) {
  const { content, attributes } = useButton(p);
  return (
    <Button
      {...attributes}
      variant={
        p.color === "danger"
          ? "destructive"
          : p.variant === "primary" || p.variant === "solid"
            ? "default"
            : p.variant === "soft"
              ? "secondary"
              : p.variant === "borderless" || p.variant === "ghost"
                ? "ghost"
                : "outline"
      }
      size={p.size === "sm" || p.size === "xs" ? "sm" : "lg"}
      className={cn(p.block ? "w-full" : undefined, "px-3.5")}
    >
      {content}
    </Button>
  );
}

export const chatcnStandard: Record<string, (p: StandardProps) => ReactNode> = {
  Badge: ChatcnBadge,
  Button: ChatcnButton,
  Divider: (p) => (
    <Separator
      orientation={p.axis === "vertical" ? "vertical" : "horizontal"}
    />
  ),
};

type Own =
  | "Stat"
  | "StatGroup"
  | "KeyValueList"
  | "Heading"
  | "Alert"
  | "Callout"
  | "Progress";

export const chatcnOwn: Partial<RendererMap<Own>> = {
  Stat: ({ props }) => (
    <ShadcnCard className="gap-2 py-4">
      <span className="truncate text-sm text-muted-foreground">
        {str(props.label)}
      </span>
      <span className="text-2xl font-semibold tabular-nums">
        {valueText(props.value)}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TrendBadge delta={props.delta} trend={props.trend} />
        {props.caption ? (
          <span className="text-xs text-muted-foreground">{props.caption}</span>
        ) : null}
      </div>
    </ShadcnCard>
  ),
  StatGroup: ({ props }) => (
    <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
      {asArray<Record<string, unknown>>(props.items).map((it, i) => (
        <ShadcnCard key={i} className="gap-2 py-4">
          <span className="text-sm text-muted-foreground">{str(it.label)}</span>
          <span className="text-2xl font-semibold tabular-nums">
            {valueText(it.value)}
          </span>
          <TrendBadge delta={str(it.delta)} trend={str(it.trend)} />
        </ShadcnCard>
      ))}
    </div>
  ),
  KeyValueList: ({ props }) => (
    <ShadcnCard className="gap-2">
      {props.title ? (
        <div className="font-medium leading-none">{props.title}</div>
      ) : null}
      <dl className="flex flex-col">
        {asArray<{ label?: string; value?: unknown; hint?: string }>(
          props.items,
        ).map((it, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-4 border-b py-2 text-sm last:border-b-0"
          >
            <dt className="text-muted-foreground">{str(it.label)}</dt>
            <dd className="text-right font-medium tabular-nums">
              {valueText(it.value)}
              {it.hint ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  {it.hint}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </ShadcnCard>
  ),
  Heading: ({ props }) => (
    <header className="flex min-w-0 flex-col gap-1">
      {props.eyebrow ? (
        <span className="text-sm font-medium text-muted-foreground">
          {props.eyebrow}
        </span>
      ) : null}
      <h2
        className={cn(
          "font-semibold tracking-tight",
          props.level === "1"
            ? "text-3xl"
            : props.level === "3"
              ? "text-lg"
              : "text-2xl",
        )}
      >
        {props.text}
      </h2>
      {props.subtitle ? (
        <p className="text-sm text-muted-foreground">{props.subtitle}</p>
      ) : null}
    </header>
  ),
  // shadcn's Alert is role="alert"; only an error should interrupt a screen reader, as the default Alert does.
  Alert: ({ props }) => (
    <Alert
      role={props.tone === "error" ? "alert" : "status"}
      variant={props.tone === "error" ? "destructive" : "default"}
    >
      {props.title ? <AlertTitle>{props.title}</AlertTitle> : null}
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  ),
  Callout: ({ props }) => (
    <Alert role={undefined}>
      {props.title ? <AlertTitle>{props.title}</AlertTitle> : null}
      <AlertDescription className="flex flex-col items-start gap-3">
        {props.text}
        {props.actionLabel && props.action ? (
          <Button size="sm" variant="outline" onClick={props.action}>
            {props.actionLabel}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  ),
  Progress: ({ props }) => (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{props.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {Math.round(props.value)}%
        </span>
      </div>
      <Progress value={Math.max(0, Math.min(100, props.value))} />
      {props.caption ? (
        <span className="text-xs text-muted-foreground">{props.caption}</span>
      ) : null}
    </div>
  ),
};
