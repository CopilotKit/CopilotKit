"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "fumadocs-ui/components/ui/popover";
import { cn } from "@/lib/cn";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import type { FrontendId } from "@/lib/stack";
import { CopilotKitLogo } from "@/components/copilotkit-logo";

// Small, self-contained mock of a docs page, used to show each idea in
// motion. Everything here is illustrative; nothing is wired to real routes.

export type MockFrontend = Extract<
  FrontendId,
  "react" | "vue" | "angular" | "react-native"
>;

export const MOCK_FRONTENDS: { id: MockFrontend; name: string }[] = [
  { id: "react", name: "React" },
  { id: "vue", name: "Vue" },
  { id: "angular", name: "Angular" },
  { id: "react-native", name: "React Native" },
];

// Demo counts are the `features` lists in each showcase manifest.
export const MOCK_BACKENDS = [
  {
    id: "built-in-agent",
    name: "Built-in agent",
    demos: 37,
    interrupts: false,
  },
  { id: "mastra", name: "Mastra", demos: 45, interrupts: true },
  {
    id: "langgraph-python",
    name: "LangGraph (Python)",
    demos: 38,
    interrupts: false,
  },
  { id: "crewai-crews", name: "CrewAI Flows", demos: 42, interrupts: true },
  { id: "pydantic-ai", name: "Pydantic AI", demos: 37, interrupts: false },
  {
    id: "google-adk",
    name: "Agent Development Kit (ADK)",
    demos: 38,
    interrupts: true,
  },
] as const;

export type MockBackendId = (typeof MOCK_BACKENDS)[number]["id"];

export function backendName(id: MockBackendId) {
  return MOCK_BACKENDS.find((b) => b.id === id)?.name ?? id;
}

export function frontendName(id: MockFrontend) {
  return MOCK_FRONTENDS.find((f) => f.id === id)?.name ?? id;
}

export function providerCode(frontend: MockFrontend): {
  file: string;
  code: string;
} {
  switch (frontend) {
    case "vue":
      return {
        file: "src/App.vue",
        code: `<CopilotKit runtime-url="/api/copilotkit">\n  <RouterView />\n</CopilotKit>`,
      };
    case "angular":
      return {
        file: "src/app/app.config.ts",
        code: `providers: [\n  provideCopilotKit({ runtimeUrl: "/api/copilotkit" }),\n]`,
      };
    case "react-native":
      return {
        file: "App.tsx",
        code: `<CopilotKitProvider runtimeUrl={RUNTIME_URL}>\n  <ChatScreen />\n</CopilotKitProvider>`,
      };
    default:
      return {
        file: "app/page.tsx",
        code: `<CopilotKitProvider runtimeUrl="/api/copilotkit">\n  <CopilotChat />\n</CopilotKitProvider>`,
      };
  }
}

export function agentCode(backend: MockBackendId): string {
  switch (backend) {
    case "mastra":
      return `default: getLocalAgent({ mastra, agentId: "weatherAgent" })`;
    case "langgraph-python":
      return `default: new LangGraphAgent({ deploymentUrl, graphId: "agent" })`;
    default:
      return `default: new HttpAgent({ url: AGENT_URL }) // ${backendName(backend)} over AG-UI`;
  }
}

export function Frame({
  url,
  header,
  children,
  className,
}: {
  url: string;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 overflow-hidden rounded-2xl border bg-fd-card text-[13px] leading-snug shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b bg-fd-background px-3 py-2">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-fd-muted px-2 py-0.5 font-mono text-xs text-fd-muted-foreground">
          docs.copilotkit.ai{url}
        </span>
      </div>
      {header}
      {children}
    </div>
  );
}

export function Shell({
  sidebar,
  children,
  rail,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  rail?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid min-h-[22rem]",
        rail
          ? "grid-cols-[10.5rem_minmax(0,1fr)_9.5rem]"
          : "grid-cols-[10.5rem_minmax(0,1fr)]",
      )}
    >
      <aside className="flex flex-col gap-2 border-e bg-fd-background/60 p-2.5">
        {sidebar}
      </aside>
      <main className="flex min-w-0 flex-col gap-3 bg-fd-background p-4">
        {children}
      </main>
      {rail ? (
        <aside className="border-s bg-fd-background p-2.5">{rail}</aside>
      ) : null}
    </div>
  );
}

export function NavList({
  items,
  active,
}: {
  items: string[];
  active?: string;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li
          key={item}
          className={cn(
            "truncate rounded-md px-2 py-1 text-fd-muted-foreground",
            item === active && "bg-fd-primary/10 text-fd-primary",
          )}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <p className="text-xl leading-tight font-semibold tracking-[-0.02em]">
      {children}
    </p>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-fd-muted-foreground">{children}</p>;
}

export function Code({ file, children }: { file?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-fd-card">
      {file ? (
        <p className="border-b px-3 py-1.5 font-mono text-xs text-fd-muted-foreground">
          {file}
        </p>
      ) : null}
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

export interface PickOption<T extends string> {
  id: T;
  name: string;
  icon?: ReactNode;
  note?: string;
  disabled?: boolean;
}

/** A Fumadocs-style dropdown trigger with a menu, for the mocks. */
export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label?: string;
  value: T;
  options: PickOption<T>[];
  onChange: (id: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border bg-fd-secondary/60 px-2 py-1.5 text-start transition-colors hover:bg-fd-accent data-[popup-open]:bg-fd-accent",
          className,
        )}
      >
        {current?.icon}
        <span className="flex min-w-0 flex-1 flex-col">
          {label ? (
            <span className="text-xs leading-tight text-fd-muted-foreground">
              {label}
            </span>
          ) : null}
          <span className="truncate font-medium">{current?.name}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-fd-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-56 p-1 text-[13px]"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-disabled={o.disabled || undefined}
            onClick={() => {
              if (o.disabled) return;
              onChange(o.id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-fd-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:bg-transparent"
          >
            {o.icon}
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.note ? (
              <span className="text-xs text-fd-muted-foreground">{o.note}</span>
            ) : null}
            {o.id === value ? (
              <Check className="size-3.5 text-fd-primary" />
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function frontendOptions(): PickOption<MockFrontend>[] {
  return MOCK_FRONTENDS.map((f) => ({
    id: f.id,
    name: f.name,
    icon: <FrontendLogo icon={f.id} size={14} className="shrink-0" />,
  }));
}

export function backendOptions(): PickOption<MockBackendId>[] {
  return MOCK_BACKENDS.map((b) => ({
    id: b.id,
    name: b.name,
    icon: <FrameworkLogo slug={b.id} size={14} className="shrink-0" />,
  }));
}

export function SmallLogo() {
  return <CopilotKitLogo className="mx-1 mb-1 h-3.5 w-auto" />;
}
