"use client";

import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const emojiOptions = [
  { emoji: "🌮", label: "Taco" },
  { emoji: "✨", label: "Sparkles" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "🎉", label: "Party" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "💜", label: "Heart" },
  { emoji: "⚡", label: "Bolt" },
] as const;

const emojiValues = emojiOptions.map((option) => option.emoji);

export const makeItRainSchema = z.object({
  reason: z
    .string()
    .max(120)
    .optional()
    .describe("A short reason for showing the emoji picker."),
  options: z
    .array(z.string().min(1).max(8))
    .min(2)
    .max(6)
    .optional()
    .describe("Optional emoji choices for the user to pick from."),
});

type MakeItRainArgs = z.infer<typeof makeItRainSchema>;

type RainDrop = {
  delay: number;
  driftEnd: number;
  driftStart: number;
  duration: number;
  emoji: string;
  id: string;
  left: number;
  rotation: number;
  size: number;
};

type RainShower = {
  drops: RainDrop[];
  id: string;
};

type CompletedRainResult = {
  emoji?: unknown;
  status?: unknown;
};

type RainPlaybackStatus = "idle" | "active" | "finished";

function MakeItRain() {
  const [showers, setShowers] = React.useState<RainShower[]>([]);
  const prefersReducedMotion = useReducedMotion();

  const startRain = React.useCallback((emoji: string) => {
    const id = crypto.randomUUID();
    const drops = createRainDrops(id, emoji);
    const longestDrop = Math.max(
      ...drops.map((drop) => drop.delay + drop.duration),
    );

    const rainDuration = longestDrop + 250;

    setShowers((current) => [...current, { id, drops }]);
    window.setTimeout(() => {
      setShowers((current) => current.filter((shower) => shower.id !== id));
    }, rainDuration);

    return rainDuration;
  }, []);

  useHumanInTheLoop<MakeItRainArgs>(
    {
      name: "makeItRain",
      description:
        "Ask the user to pick an emoji, then rain that emoji across the screen.",
      parameters: makeItRainSchema,
      followUp: false,
      render: (props) => <MakeItRainPicker {...props} onRain={startRain} />,
    },
    [startRain],
  );

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {showers.flatMap((shower) =>
        shower.drops.map((drop) => (
          <motion.span
            key={drop.id}
            data-rain-drop
            className="fixed top-0 select-none will-change-transform"
            initial={{
              opacity: 0,
              rotate: 0,
              x: drop.driftStart,
              y: "-16vh",
            }}
            animate={{
              opacity: prefersReducedMotion ? [0, 1, 0] : [0, 1, 1, 0],
              rotate: prefersReducedMotion ? 0 : drop.rotation,
              x: prefersReducedMotion ? drop.driftStart : drop.driftEnd,
              y: "112vh",
            }}
            transition={{
              delay: drop.delay / 1000,
              duration: drop.duration / 1000,
              ease: "linear",
              opacity: {
                delay: drop.delay / 1000,
                duration: drop.duration / 1000,
                ease: "linear",
                times: prefersReducedMotion ? [0, 0.2, 1] : [0, 0.12, 0.88, 1],
              },
            }}
            style={{
              fontSize: `${drop.size}px`,
              left: `${drop.left}%`,
            }}
          >
            {drop.emoji}
          </motion.span>
        )),
      )}
    </div>
  );
}

function MakeItRainPicker({
  args,
  onRain,
  respond,
  result,
  status,
  toolCallId,
}: {
  args: Partial<MakeItRainArgs>;
  onRain: (emoji: string) => number;
  respond?: (result: unknown) => Promise<void>;
  result?: unknown;
  status: string;
  toolCallId: string;
}) {
  const options = getEmojiOptions(args.options);
  const [requestedEmoji, setRequestedEmoji] = React.useState(options[0].emoji);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [rainedEmoji, setRainedEmoji] = React.useState<string | null>(null);
  const [rainPlaybackStatus, setRainPlaybackStatus] =
    React.useState<RainPlaybackStatus>("idle");
  const rainedToolCallIdRef = React.useRef<string | null>(null);
  const finishRainTimerRef = React.useRef<number | null>(null);
  const selectedEmoji = options.some(
    (option) => option.emoji === requestedEmoji,
  )
    ? requestedEmoji
    : options[0].emoji;
  const completedResultEmoji = getCompletedEmoji(result);
  const completedEmoji =
    rainedEmoji ??
    completedResultEmoji ??
    (status === "complete" ? selectedEmoji : undefined);
  const canSubmit = status === "executing" && Boolean(respond);

  const triggerRain = React.useCallback(
    (emoji: string) => {
      if (rainedToolCallIdRef.current === toolCallId) {
        return;
      }

      rainedToolCallIdRef.current = toolCallId;
      setRainedEmoji(emoji);
      setRainPlaybackStatus("active");

      if (finishRainTimerRef.current !== null) {
        window.clearTimeout(finishRainTimerRef.current);
      }

      const rainDuration = onRain(emoji);
      finishRainTimerRef.current = window.setTimeout(() => {
        setRainPlaybackStatus("finished");
        finishRainTimerRef.current = null;
      }, rainDuration);
    },
    [onRain, toolCallId],
  );

  React.useEffect(() => {
    if (status === "complete" && completedEmoji) {
      triggerRain(completedEmoji);
    }
  }, [completedEmoji, status, triggerRain]);

  React.useEffect(() => {
    return () => {
      if (finishRainTimerRef.current !== null) {
        window.clearTimeout(finishRainTimerRef.current);
      }
    };
  }, []);

  if (completedEmoji || status === "complete") {
    return (
      <Card
        size="sm"
        className="w-full max-w-full border border-border/70 bg-card/95 shadow-none"
      >
        <CardHeader className="gap-1">
          <CardTitle className="text-base">
            Made it rain {completedEmoji ?? selectedEmoji}
          </CardTitle>
          <CardDescription>
            {rainPlaybackStatus === "active"
              ? "The animation is running."
              : rainPlaybackStatus === "finished"
                ? "The animation has finished."
                : "Starting the animation."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const reason =
    typeof args.reason === "string" && args.reason.trim()
      ? args.reason.trim()
      : "Pick the emoji for the full-screen effect.";

  async function handleRain() {
    setIsSubmitting(true);
    triggerRain(selectedEmoji);

    try {
      await respond?.({ emoji: selectedEmoji, status: "raining" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card
      size="sm"
      className="w-full max-w-full border border-border/70 bg-card/95 shadow-none"
    >
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Pick an emoji</CardTitle>
        <CardDescription>{reason}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-start">
              <span className="text-lg">{selectedEmoji}</span>
              <span>Choose emoji</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-44 w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuLabel>Emoji</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selectedEmoji}
              onValueChange={setRequestedEmoji}
            >
              {options.map((option) => (
                <DropdownMenuRadioItem key={option.emoji} value={option.emoji}>
                  <span className="text-base">{option.emoji}</span>
                  <span>{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          className="w-full"
          disabled={isSubmitting || !canSubmit}
          onClick={() => {
            void handleRain();
          }}
        >
          {isSubmitting
            ? "Raining..."
            : canSubmit
              ? `Make it rain ${selectedEmoji}`
              : "Waiting for the assistant"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function getEmojiOptions(options: unknown) {
  if (!Array.isArray(options)) {
    return [...emojiOptions];
  }

  const allowedEmojiValues: readonly string[] = emojiValues;
  const customOptions = options
    .filter((emoji): emoji is string => typeof emoji === "string")
    .filter((emoji) => allowedEmojiValues.includes(emoji));

  if (customOptions.length < 2) {
    return [...emojiOptions];
  }

  return customOptions.map((emoji) => {
    const knownOption = emojiOptions.find((option) => option.emoji === emoji);

    return knownOption ?? { emoji, label: "Custom" };
  });
}

function createRainDrops(showerId: string, emoji: string): RainDrop[] {
  return Array.from({ length: 88 }, (_, index) => ({
    delay: Math.floor(Math.random() * 1600),
    driftEnd: Math.round((Math.random() - 0.5) * 96),
    driftStart: Math.round((Math.random() - 0.5) * 24),
    duration: 6500 + Math.floor(Math.random() * 2200),
    emoji,
    id: `${showerId}-${index}`,
    left: Math.round(Math.random() * 100),
    rotation: Math.round((Math.random() - 0.5) * 240),
    size: 18 + Math.floor(Math.random() * 14),
  }));
}

function getCompletedEmoji(result: unknown) {
  const parsedResult = parseCompletedRainResult(result);

  return typeof parsedResult?.emoji === "string"
    ? parsedResult.emoji
    : undefined;
}

function parseCompletedRainResult(result: unknown): CompletedRainResult | null {
  if (!result) {
    return null;
  }

  if (typeof result === "object") {
    return result as CompletedRainResult;
  }

  if (typeof result !== "string") {
    return null;
  }

  try {
    return JSON.parse(result) as CompletedRainResult;
  } catch {
    return null;
  }
}

export { MakeItRain };
