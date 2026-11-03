"use client";

import { useState } from "react";
import { ChevronDown, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import {
  Code,
  Dropdown,
  Frame,
  Lead,
  MOCK_BACKENDS,
  MOCK_FRONTENDS,
  NavList,
  Shell,
  SmallLogo,
  Title,
  agentCode,
  backendName,
  backendOptions,
  frontendName,
  frontendOptions,
  providerCode,
  type MockBackendId,
  type MockFrontend,
} from "./mock";

const NAV = [
  "Quickstart",
  "Generative UI",
  "Human in the loop",
  "Shared state",
  "Threads",
];

function useMockStack(
  frontend: MockFrontend = "react",
  backend: MockBackendId = "mastra",
) {
  const [f, setF] = useState<MockFrontend>(frontend);
  const [b, setB] = useState<MockBackendId>(backend);
  return { f, setF, b, setB };
}

function ProviderBlock({ f }: { f: MockFrontend }) {
  const { file, code } = providerCode(f);
  return <Code file={file}>{code}</Code>;
}

function AgentBlock({ b }: { b: MockBackendId }) {
  return (
    <Code file="app/api/copilotkit/route.ts">{`new CopilotRuntime({\n  agents: {\n    ${agentCode(b)},\n  },\n})`}</Code>
  );
}

/* 1. Sentry: the platform picker scopes the whole sidebar; neutral URLs ask. */
export function SentryMock() {
  const { f, b, setB } = useMockStack();
  const [deadEnd, setDeadEnd] = useState(false);
  return (
    <>
      <div className="not-prose flex gap-2">
        {(["Scoped page", "Unscoped link"] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setDeadEnd(i === 1)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              deadEnd === (i === 1)
                ? "bg-fd-primary/10 text-fd-primary"
                : "text-fd-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Frame
        url={
          deadEnd
            ? "/docs/framework-redirect?next=/human-in-the-loop"
            : `/docs/${b}/human-in-the-loop`
        }
      >
        <Shell
          sidebar={
            <>
              <SmallLogo />
              <Dropdown value={b} options={backendOptions()} onChange={setB} />
              <NavList
                items={NAV}
                active={deadEnd ? undefined : "Human in the loop"}
              />
            </>
          }
        >
          {deadEnd ? (
            <>
              <Title>Human in the loop</Title>
              <div className="flex gap-2 rounded-xl border border-fd-primary/30 bg-fd-primary/5 p-3">
                <Info className="mt-0.5 size-4 shrink-0 text-fd-primary" />
                <p>
                  This page is written for each agent framework. Pick yours and
                  we&apos;ll take you to its version.
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-1.5">
                {MOCK_BACKENDS.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setB(x.id);
                        setDeadEnd(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-start hover:bg-fd-accent"
                    >
                      <FrameworkLogo slug={x.id} size={14} />
                      {x.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-xs text-fd-muted-foreground">
                Integrations / {backendName(b)}
              </p>
              <Title>Human in the loop for {backendName(b)}</Title>
              <div className="flex items-center gap-3 rounded-xl border border-fd-primary/25 bg-fd-primary/5 px-3 py-2">
                <Sparkles className="size-4 shrink-0 text-fd-primary" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  Add human approvals to my {backendName(b)} agent with
                  CopilotKit…
                </span>
                <span className="rounded-md border bg-fd-background px-2 py-0.5 text-xs">
                  Copy prompt
                </span>
              </div>
              <AgentBlock b={b} />
              <ProviderBlock f={f} />
            </>
          )}
        </Shell>
      </Frame>
    </>
  );
}

/* 2. Clerk: a labelled SDK select, plus "Available in other SDKs" tiles. */
export function ClerkMock() {
  const { f, b, setB } = useMockStack();
  return (
    <Frame url={`/docs/${b}/human-in-the-loop`}>
      <Shell
        sidebar={
          <>
            <SmallLogo />
            <div className="rounded-xl border bg-fd-background p-1.5 shadow-sm">
              <p className="px-1 pb-1 text-xs font-medium">
                Select your agent framework
              </p>
              <Dropdown value={b} options={backendOptions()} onChange={setB} />
            </div>
            <NavList items={NAV} active="Human in the loop" />
          </>
        }
        rail={
          <div className="flex flex-col gap-2 rounded-xl bg-fd-muted p-2">
            <p className="text-xs font-medium">Available for</p>
            <div className="grid grid-cols-3 gap-1.5">
              {MOCK_BACKENDS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  title={x.name}
                  aria-label={x.name}
                  onClick={() => setB(x.id)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-lg border bg-fd-background transition-opacity hover:opacity-100",
                    x.id === b
                      ? "ring-1 ring-fd-primary"
                      : "opacity-60 grayscale hover:grayscale-0",
                  )}
                >
                  <FrameworkLogo slug={x.id} size={18} />
                </button>
              ))}
            </div>
          </div>
        }
      >
        <Title>Human in the loop</Title>
        <Lead>
          Pause your {backendName(b)} agent for a person&apos;s approval.
        </Lead>
        <AgentBlock b={b} />
        <ProviderBlock f={f} />
      </Shell>
    </Frame>
  );
}

/* 3. Storybook: frontend chips right under the title, on every page. */
export function StorybookMock() {
  const { f, setF, b } = useMockStack();
  return (
    <Frame url={`/docs/${b}/human-in-the-loop?frontend=${f}`}>
      <Shell
        sidebar={
          <>
            <SmallLogo />
            <NavList items={NAV} active="Human in the loop" />
          </>
        }
      >
        <Title>Human in the loop</Title>
        <div className="flex flex-wrap items-center gap-1.5">
          {MOCK_FRONTENDS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setF(x.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5",
                x.id === f
                  ? "border-fd-primary text-fd-primary"
                  : "text-fd-muted-foreground",
              )}
            >
              <FrontendLogo icon={x.id} size={12} />
              {x.name}
            </button>
          ))}
          <span className="ms-auto rounded-md border px-2 py-0.5 text-xs text-fd-muted-foreground">
            Copy markdown
          </span>
        </div>
        <Lead>
          Show an approval card in your {frontendName(f)} app before the agent
          acts.
        </Lead>
        <ProviderBlock f={f} />
      </Shell>
    </Frame>
  );
}

/* 4. Stripe: the page's first fork as buttons, then a language switch on code. */
export function StripeMock() {
  const { f, setF, b } = useMockStack();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [lang, setLang] = useState<"TypeScript" | "Python">("TypeScript");
  return (
    <Frame url={`/docs/${b}/quickstart`}>
      <Shell
        sidebar={
          <>
            <SmallLogo />
            <NavList items={NAV} active="Quickstart" />
          </>
        }
      >
        <Title>Quickstart</Title>
        <Lead>Connect your {backendName(b)} agent to your app.</Lead>
        <div className="flex flex-wrap gap-1.5">
          {MOCK_FRONTENDS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setF(x.id)}
              className={cn(
                "rounded-md border px-2.5 py-1",
                x.id === f
                  ? "border-fd-primary text-fd-primary ring-1 ring-fd-primary/40"
                  : "",
              )}
            >
              {x.name}
            </button>
          ))}
        </div>
        <div className="flex gap-4 border-b text-sm">
          {(["new", "existing"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "-mb-px border-b-2 pb-1.5",
                mode === m
                  ? "border-fd-primary text-fd-primary"
                  : "border-transparent text-fd-muted-foreground",
              )}
            >
              {m === "new" ? "New app" : "Existing app"}
            </button>
          ))}
        </div>
        <ProviderBlock f={f} />
        <div className="overflow-hidden rounded-xl border bg-fd-card">
          <div className="flex items-center border-b px-3 py-1.5">
            <span className="flex-1 font-mono text-xs text-fd-muted-foreground">
              agent
            </span>
            <button
              type="button"
              onClick={() =>
                setLang(lang === "TypeScript" ? "Python" : "TypeScript")
              }
              className="inline-flex items-center gap-1 rounded-md border bg-fd-background px-2 py-0.5 text-xs"
            >
              {lang}
              <ChevronDown className="size-3" />
            </button>
          </div>
          <pre className="px-3 py-2 font-mono text-xs">
            {lang === "TypeScript"
              ? `export const agent = new Agent({ name: "assistant" })`
              : `agent = Agent(name="assistant")`}
          </pre>
        </div>
      </Shell>
    </Frame>
  );
}

/* 5. Expo: answer two questions with picture cards; the steps follow. */
export function ExpoMock() {
  const { f, setF, b, setB } = useMockStack();
  return (
    <Frame url={`/docs/${b}/quickstart?frontend=${f}`}>
      <Shell
        sidebar={
          <>
            <SmallLogo />
            <NavList items={NAV} active="Quickstart" />
          </>
        }
      >
        <Title>Quickstart</Title>
        <p className="font-medium">What are you building with?</p>
        <div className="grid grid-cols-4 gap-2">
          {MOCK_FRONTENDS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setF(x.id)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border bg-fd-card p-3 transition-colors",
                x.id === f
                  ? "border-fd-primary bg-fd-primary/5"
                  : "hover:bg-fd-accent",
              )}
            >
              <FrontendLogo icon={x.id} size={28} />
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  className={cn(
                    "size-3 rounded-full border",
                    x.id === f && "border-4 border-fd-primary",
                  )}
                />
                {x.name}
              </span>
            </button>
          ))}
        </div>
        <p className="font-medium">Where does your agent run?</p>
        <div className="grid grid-cols-3 gap-2">
          {MOCK_BACKENDS.slice(0, 6).map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setB(x.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-start transition-colors",
                x.id === b
                  ? "border-fd-primary bg-fd-primary/5"
                  : "hover:bg-fd-accent",
              )}
            >
              <FrameworkLogo slug={x.id} size={16} />
              <span className="truncate text-xs">{x.name}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-fd-muted-foreground">
          Your steps for {frontendName(f)} with {backendName(b)}
        </p>
        <ProviderBlock f={f} />
      </Shell>
    </Frame>
  );
}

/* 6. Prisma: one sentence says what the page uses and offers the switch. */
export function PrismaMock() {
  const { f, setF, b, setB } = useMockStack();
  const otherF = MOCK_FRONTENDS.find((x) => x.id !== f)!;
  const otherB = MOCK_BACKENDS.find((x) => x.id !== b)!;
  return (
    <Frame url={`/docs/${b}/human-in-the-loop`}>
      <Shell
        sidebar={
          <>
            <SmallLogo />
            <NavList items={NAV} active="Human in the loop" />
          </>
        }
      >
        <Title>Human in the loop</Title>
        <p>
          This page uses{" "}
          <span className="inline-flex items-center gap-1 font-medium">
            <FrontendLogo icon={f} size={13} />
            {frontendName(f)}
          </span>{" "}
          and{" "}
          <span className="inline-flex items-center gap-1 font-medium">
            <FrameworkLogo slug={b} size={13} />
            {backendName(b)}
          </span>
          .{" "}
          <button
            type="button"
            onClick={() => setF(otherF.id)}
            className="font-medium underline decoration-fd-primary underline-offset-4"
          >
            Use {otherF.name} instead
          </button>{" "}
          ·{" "}
          <button
            type="button"
            onClick={() => setB(otherB.id)}
            className="font-medium underline decoration-fd-primary underline-offset-4"
          >
            Use {otherB.name}
          </button>
        </p>
        <AgentBlock b={b} />
        <ProviderBlock f={f} />
      </Shell>
    </Frame>
  );
}

const CAPS = [
  "Generative UI",
  "Human in the loop",
  "Shared state",
  "Subagents",
  "A2UI",
  "Voice",
];

/* 7. AI SDK: a directory of frameworks with capability chips; each has a home. */
export function DirectoryMock() {
  const [open, setOpen] = useState<MockBackendId | null>(null);
  return (
    <Frame url={open ? `/docs/${open}` : "/docs/integrations"}>
      <Shell
        sidebar={
          <>
            <SmallLogo />
            <NavList
              items={["Integrations", ...MOCK_BACKENDS.map((x) => x.name)]}
              active={open ? backendName(open) : "Integrations"}
            />
          </>
        }
      >
        {open ? (
          <>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="self-start text-xs text-fd-primary"
            >
              ← All integrations
            </button>
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-xl border bg-fd-card">
                <FrameworkLogo slug={open} size={28} />
              </span>
              <Title>CopilotKit for {backendName(open)}</Title>
            </div>
            <Lead>
              Everything {backendName(open)} can do with CopilotKit, with a live
              demo for each.
            </Lead>
            <AgentBlock b={open} />
          </>
        ) : (
          <>
            <Title>Integrations</Title>
            <Lead>
              Pick your agent framework. Each has its own guide and live demos.
            </Lead>
            <div className="grid grid-cols-2 gap-2">
              {MOCK_BACKENDS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setOpen(x.id)}
                  className="flex flex-col gap-2 rounded-xl border bg-fd-card p-3 text-start transition-colors hover:bg-fd-accent"
                >
                  <span className="flex items-center gap-2">
                    <FrameworkLogo slug={x.id} size={20} />
                    <span className="font-medium">{x.name}</span>
                    <span className="ms-auto text-xs text-fd-muted-foreground">
                      {x.demos} demos
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {[...CAPS, ...(x.interrupts ? ["Interrupts"] : [])]
                      .slice(0, 5)
                      .map((c) => (
                        <span
                          key={c}
                          className="rounded-md border bg-fd-background px-1.5 py-0.5 text-xs text-fd-muted-foreground"
                        >
                          {c}
                        </span>
                      ))}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </Shell>
    </Frame>
  );
}

/* 8. Amplify + LangChain: product tabs on top, a labelled framework choice. */
export function ProductTabsMock() {
  const { f, setF, b } = useMockStack();
  const [tab, setTab] = useState("Docs");
  return (
    <Frame
      url={
        tab === "Intelligence" ? "/intelligence" : `/docs/${b}?frontend=${f}`
      }
      header={
        <div className="flex gap-4 border-b bg-fd-background px-4 text-sm">
          {["Docs", "Integrations", "Intelligence", "Reference"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 py-2",
                tab === t
                  ? "border-fd-foreground font-medium"
                  : "border-transparent text-fd-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      }
    >
      <Shell
        sidebar={
          <>
            <p className="px-1 text-xs font-semibold">Choose your frontend</p>
            <Dropdown value={f} options={frontendOptions()} onChange={setF} />
            <NavList
              items={
                tab === "Intelligence"
                  ? [
                      "Overview",
                      "Threads",
                      "Memory",
                      "Learning",
                      "Self-hosting",
                    ]
                  : NAV
              }
            />
          </>
        }
      >
        <Title>
          {tab === "Intelligence"
            ? "CopilotKit Intelligence"
            : `CopilotKit for ${frontendName(f)}`}
        </Title>
        <Lead>Build with your framework:</Lead>
        <div className="flex gap-2">
          {MOCK_FRONTENDS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-label={x.name}
              onClick={() => setF(x.id)}
              className={cn(
                "flex size-12 items-center justify-center rounded-xl border bg-fd-card",
                x.id === f && "ring-1 ring-fd-primary",
              )}
            >
              <FrontendLogo icon={x.id} size={24} />
            </button>
          ))}
        </div>
        <ProviderBlock f={f} />
      </Shell>
    </Frame>
  );
}

/* 9. Supabase: every framework gets its own quickstart page, listed by name. */
export function QuickstartListMock() {
  const [page, setPage] = useState<MockBackendId | null>(null);
  return (
    <Frame url={page ? `/docs/${page}/quickstart` : "/docs/getting-started"}>
      <Shell
        sidebar={
          <>
            <SmallLogo />
            <NavList
              items={["Getting started", "Concepts"]}
              active={page ? undefined : "Getting started"}
            />
            <p className="px-2 pt-2 font-mono text-xs tracking-wide text-fd-muted-foreground">
              AGENT QUICKSTARTS
            </p>
            <ul className="flex flex-col gap-0.5">
              {MOCK_BACKENDS.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => setPage(x.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-start",
                      page === x.id
                        ? "bg-fd-primary/10 text-fd-primary"
                        : "text-fd-muted-foreground hover:bg-fd-accent",
                    )}
                  >
                    <FrameworkLogo slug={x.id} size={13} />
                    <span className="truncate">{x.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        }
      >
        {page ? (
          <>
            <Title>Use CopilotKit with {backendName(page)}</Title>
            <Lead>
              Build a chat app on a {backendName(page)} agent in five minutes.
            </Lead>
            <AgentBlock b={page} />
          </>
        ) : (
          <>
            <Title>Getting started</Title>
            <p className="font-medium">Agent quickstarts</p>
            <div className="grid grid-cols-3 gap-2">
              {MOCK_BACKENDS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setPage(x.id)}
                  className="flex flex-col gap-1.5 rounded-xl border bg-fd-card p-2.5 text-start hover:bg-fd-accent"
                >
                  <FrameworkLogo slug={x.id} size={18} />
                  <span className="font-medium">{x.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Shell>
    </Frame>
  );
}
