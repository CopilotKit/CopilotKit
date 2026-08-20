"use client";

import dynamic from "next/dynamic";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { LoaderCircleIcon, MapPinIcon, SearchIcon } from "lucide-react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { Attraction, TravelState } from "@/lib/travel";
import { cn } from "@/lib/utils";

const AGENT_ID = "travel";
const SAN_FRANCISCO: [number, number] = [37.7749, -122.4194];
const INITIAL_STATE: TravelState = {
  status: "Ready",
  search_area: "San Francisco, California",
  center: SAN_FRANCISCO,
  attractions: [],
};

const LocationMap = dynamic(() => import("@/components/location-map"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

function AttractionList({ attractions }: { attractions: Attraction[] }) {
  if (attractions.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Attractions will appear here as the agent adds them.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ol className="px-4">
        {attractions.map((attraction, index) => (
          <li key={attraction.id}>
            <div className="flex gap-3 py-4">
              <Badge
                variant="secondary"
                className="mt-0.5 size-6 shrink-0 rounded-full p-0 font-mono tabular-nums"
              >
                {index + 1}
              </Badge>
              <div className="min-w-0">
                <p className="font-medium">{attraction.name}</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {attraction.description}
                </p>
              </div>
            </div>
            {index < attractions.length - 1 && <Separator />}
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}

export default function Home() {
  const { agent, isReady } = useAgent({ agentId: AGENT_ID });
  const { copilotkit } = useCopilotKit();
  const [request, setRequest] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (!isReady) return;

    const subscription = agent.subscribe({
      onRunErrorEvent: ({ event }) => setRunError(event.message),
      onRunFailed: ({ error }) => setRunError(error.message),
    });

    return () => subscription.unsubscribe();
  }, [agent, isReady]);

  const state = {
    ...INITIAL_STATE,
    ...(agent.state as Partial<TravelState>),
  };

  const startWorkflow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = request.trim();
    if (!prompt) return;

    setHasStarted(true);
    setRunError(null);
    agent.setMessages([]);
    agent.setState({
      ...INITIAL_STATE,
      status: "Starting travel scout",
      attractions: [],
    });
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    });

    await copilotkit.runAgent({ agent });
  };

  return (
    <main className="relative h-dvh min-h-[540px] overflow-hidden bg-background">
      <div className="absolute inset-0">
        <LocationMap center={state.center} attractions={state.attractions} />
      </div>

      <div
        className={cn(
          "absolute z-[900] flex w-[calc(100%-2rem)] max-w-[620px] flex-col items-start transition-[left,top,transform] duration-700 ease-out motion-reduce:transition-none",
          hasStarted
            ? "left-4 top-4 translate-x-0 translate-y-0"
            : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        )}
      >
        <Card
          className={cn(
            "relative isolate w-full gap-0 overflow-visible rounded-full bg-card py-0 shadow-xl",
            agent.isRunning && "magic-border",
          )}
        >
          <form
            role="search"
            onSubmit={startWorkflow}
            className="relative flex items-center rounded-full p-1.5"
          >
            <Input
              aria-label="Search a city or market"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              disabled={agent.isRunning}
              className="h-11 min-w-0 flex-1 rounded-full border-0 bg-transparent px-5 pr-14 text-base shadow-none focus-visible:ring-0 disabled:opacity-60 dark:bg-transparent"
              placeholder="Try “5 attractions in San Francisco”"
            />
            <Button
              type="submit"
              size="icon-lg"
              variant="ghost"
              disabled={!isReady || agent.isRunning || !request.trim()}
              aria-label={
                !isReady
                  ? "Connecting"
                  : agent.isRunning
                    ? "Searching"
                    : "Search"
              }
              className="absolute right-1.5 size-11 rounded-full hover:bg-transparent"
            >
              {agent.isRunning ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <SearchIcon />
              )}
            </Button>
          </form>
        </Card>

        {runError && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-background px-4 py-3 text-sm text-destructive shadow-xl"
          >
            {runError}
          </p>
        )}

        {hasStarted && (
          <Card
            aria-live="polite"
            className="mt-3 max-h-[calc(100dvh-6rem)] w-full animate-in gap-0 overflow-hidden py-0 shadow-xl duration-500 fade-in slide-in-from-top-2"
          >
            <CardHeader className="border-b p-4">
              <CardTitle className="flex items-center justify-between gap-3">
                <span className="truncate">
                  {agent.isRunning ? state.status : state.search_area}
                </span>
                <Badge variant="secondary">{state.attractions.length}</Badge>
              </CardTitle>
              <CardDescription>
                {agent.isRunning
                  ? "Attractions appear as the agent selects them"
                  : "Approximate attractions selected by the agent"}
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 px-0">
              <AttractionList attractions={state.attractions} />
            </CardContent>
          </Card>
        )}
      </div>

      <Badge
        variant="secondary"
        className="absolute bottom-4 left-16 z-[700] max-w-[calc(100vw-5rem)] gap-1.5 shadow-lg"
        title="Coordinates are approximate and are not verified by a Places API"
      >
        <MapPinIcon data-icon="inline-start" />
        <span className="truncate">{state.search_area}</span>
      </Badge>
    </main>
  );
}
