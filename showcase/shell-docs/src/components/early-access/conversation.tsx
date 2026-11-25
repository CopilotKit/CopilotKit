import { useId } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BatteryFull,
  ChevronLeft,
  Mic,
  Phone,
  Plus,
  Signal,
  Video,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { EarlyAccessChannelId } from "@/lib/early-access/channels";
import type { ConversationMessage } from "@/lib/early-access/copy";

// A phone-style transcript in each channel's own look: iMessage's blue
// bubbles, SMS's green ones, WhatsApp's bubbles with reply buttons, and an
// RCS rich card with suggested replies. Plain HTML and CSS: the transcript is
// real text in the DOM, read in order, with who said what; the phone's chrome
// (status bar, header, composer, timestamps) is hidden from screen readers.
// The channels' colors are deepened where needed so every bubble's text
// clears 4.5:1, in both themes.

interface Theme {
  screen: string;
  /** "iMessage", "Text Message": the thread's label over the first message. */
  threadLabel?: string;
  incoming: string;
  outgoing: string;
  /** Under a message: reply buttons, suggested replies. */
  choices: "buttons" | "chips" | "numbered";
  chip: string;
  card: "bubble" | "rich" | "text";
  cardSurface: string;
  cardAction: string;
  composer: string;
  composerLabel: string;
  /** Small times inside each bubble, as WhatsApp shows them. */
  stamps: string | null;
}

const APPLE_INCOMING =
  "rounded-[1.15rem] bg-[#e9e9eb] text-black dark:bg-[#262628] dark:text-white";

const THEMES: Record<EarlyAccessChannelId, Theme> = {
  imessage: {
    screen: "bg-white dark:bg-black",
    threadLabel: "iMessage",
    incoming: APPLE_INCOMING,
    outgoing: "rounded-[1.15rem] bg-[#0068e0] text-white",
    choices: "chips",
    chip: "rounded-full border border-[#0068e0]/35 px-3 py-1 text-[#0068e0] dark:border-[#4d9fff]/45 dark:text-[#4d9fff]",
    card: "bubble",
    cardSurface: APPLE_INCOMING,
    cardAction: "text-[#0068e0] dark:text-[#4d9fff]",
    composer:
      "border-[#d1d1d6] text-[#6e6e73] dark:border-[#3a3a3c] dark:text-[#8e8e93]",
    composerLabel: "iMessage",
    stamps: null,
  },
  sms: {
    screen: "bg-white dark:bg-black",
    threadLabel: "Text Message",
    incoming: APPLE_INCOMING,
    outgoing: "rounded-[1.15rem] bg-[#1d7f39] text-white",
    choices: "numbered",
    chip: "",
    card: "text",
    cardSurface: APPLE_INCOMING,
    cardAction: "",
    composer:
      "border-[#d1d1d6] text-[#6e6e73] dark:border-[#3a3a3c] dark:text-[#8e8e93]",
    composerLabel: "Text Message",
    stamps: null,
  },
  whatsapp: {
    screen: "bg-[#efeae2] dark:bg-[#0b141a]",
    incoming:
      "rounded-lg rounded-tl-none bg-white text-[#111b21] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] dark:bg-[#202c33] dark:text-[#e9edef]",
    outgoing:
      "rounded-lg rounded-tr-none bg-[#d9fdd3] text-[#111b21] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] dark:bg-[#005c4b] dark:text-[#e9edef]",
    choices: "buttons",
    chip: "rounded-lg bg-white py-2 text-center font-medium text-[#008069] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] dark:bg-[#202c33] dark:text-[#00a884]",
    card: "bubble",
    cardSurface:
      "rounded-lg rounded-tl-none bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]",
    cardAction: "text-[#008069] dark:text-[#00a884]",
    composer:
      "border-transparent bg-white text-[#667781] dark:bg-[#202c33] dark:text-[#8696a0]",
    composerLabel: "Message",
    stamps: "text-[#667781] dark:text-[#8696a0]",
  },
  rcs: {
    screen: "bg-white dark:bg-[#131314]",
    incoming:
      "rounded-[1.25rem] rounded-bl-md bg-[#e9eef6] text-[#1f1f1f] dark:bg-[#2d2f31] dark:text-[#e3e3e3]",
    outgoing:
      "rounded-[1.25rem] rounded-br-md bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#062e6f]",
    choices: "chips",
    chip: "rounded-full border border-[#747775] px-3 py-1.5 font-medium text-[#0b57d0] dark:border-[#8e918f] dark:text-[#a8c7fa]",
    card: "rich",
    cardSurface:
      "rounded-2xl border border-[#c4c7c5] bg-white text-[#1f1f1f] dark:border-[#444746] dark:bg-[#1e1f20] dark:text-[#e3e3e3]",
    cardAction: "text-[#0b57d0] dark:text-[#a8c7fa]",
    composer:
      "border-transparent bg-[#e9eef6] text-[#444746] dark:bg-[#2d2f31] dark:text-[#c4c7c5]",
    composerLabel: "RCS message",
    stamps: null,
  },
};

/** The times the transcript shows: a minute apart from 9:41. */
const stamp = (index: number) => `9:${String(41 + index).padStart(2, "0")}`;

export function ConversationPreview({
  channel,
  name,
  contact,
  messages,
}: {
  channel: EarlyAccessChannelId;
  /** The channel's display name. */
  name: string;
  contact: string;
  messages: ConversationMessage[];
}) {
  const theme = THEMES[channel];
  const captionId = useId();
  return (
    <figure
      aria-labelledby={captionId}
      className="w-full max-w-[20.5rem] rounded-[2.9rem] bg-[#1b1b1f] p-2.5 shadow-[0_24px_48px_-24px_rgb(20_16_33/0.45)] ring-1 ring-black/5 dark:bg-[#2a2a31] dark:ring-white/10"
    >
      <figcaption id={captionId} className="sr-only">
        An example {name} conversation with {contact}
      </figcaption>
      <div
        className={cn(
          "flex min-h-[35rem] flex-col overflow-hidden rounded-[2.3rem] text-[0.875rem] leading-snug",
          theme.screen,
        )}
      >
        <StatusBar channel={channel} />
        <Header channel={channel} contact={contact} />
        <ol
          className={cn(
            "flex flex-1 flex-col justify-end gap-1 px-3 pt-3 pb-2",
            channel === "whatsapp" && "px-2.5",
          )}
        >
          {theme.threadLabel ? (
            <li
              aria-hidden="true"
              className="mb-2 text-center text-[0.6875rem] leading-tight text-[#6e6e73] dark:text-[#8e8e93]"
            >
              <span className="font-semibold">{theme.threadLabel}</span>
              <br />
              Today 9:41 AM
            </li>
          ) : null}
          {messages.map((message, index) => (
            <Message
              key={index}
              message={message}
              theme={theme}
              contact={contact}
              time={stamp(index)}
              // Messages from the same side sit close; a new speaker gets room.
              spaced={index > 0 && messages[index - 1].from !== message.from}
            />
          ))}
        </ol>
        <Composer theme={theme} />
      </div>
    </figure>
  );
}

function Message({
  message,
  theme,
  contact,
  time,
  spaced,
}: {
  message: ConversationMessage;
  theme: Theme;
  contact: string;
  time: string;
  spaced: boolean;
}) {
  const mine = message.from === "person";
  const speaker = <span className="sr-only">{mine ? "You" : contact}: </span>;
  const bubble = (children: ReactNode, className?: string) => (
    <div
      className={cn(
        "w-fit max-w-[80%] px-3 py-[0.4375rem] break-words",
        mine
          ? cn("self-end", theme.outgoing)
          : cn("self-start", theme.incoming),
        className,
      )}
    >
      {children}
      {theme.stamps ? (
        <span
          aria-hidden="true"
          className={cn(
            "float-right ms-2 mt-1.5 translate-y-1 text-[0.6875rem] leading-none",
            theme.stamps,
          )}
        >
          {time}
        </span>
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (message.kind === "text") {
    body = bubble(message.text);
  } else if (message.kind === "choices") {
    body =
      theme.choices === "numbered" ? (
        bubble(
          <>
            {message.text}
            <span className="sr-only"> Replies:</span>
            <ol className="mt-1">
              {message.choices.map((choice, index) => (
                <li key={choice}>
                  {index + 1}. {choice}
                </li>
              ))}
            </ol>
          </>,
        )
      ) : theme.choices === "buttons" ? (
        // Reply buttons hang under the message, as wide as it.
        <div className="flex w-[80%] flex-col gap-1 self-start">
          {bubble(message.text, "w-full max-w-full")}
          <ul aria-label="Reply buttons" className="flex flex-col gap-1">
            {message.choices.map((choice) => (
              <li key={choice} className={theme.chip}>
                {choice}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // Suggested replies run across the screen under the message.
        <div className="flex flex-col gap-2">
          {bubble(message.text)}
          <ul aria-label="Suggested replies" className="flex flex-wrap gap-1.5">
            {message.choices.map((choice) => (
              <li key={choice} className={theme.chip}>
                {choice}
              </li>
            ))}
          </ul>
        </div>
      );
  } else if (theme.card === "text") {
    // SMS has no cards: the same facts, as words.
    body = bubble(
      <>
        <span className="font-semibold">{message.title}</span>
        <br />
        {message.body}
        {message.actions.length ? (
          <>
            <br />
            Reply: {message.actions.join(", ")}
          </>
        ) : null}
      </>,
    );
  } else {
    body = (
      <div
        className={cn(
          "w-[80%] self-start overflow-hidden",
          theme.cardSurface,
          theme.card === "bubble" && "px-3 pt-2",
        )}
      >
        <div className={cn(theme.card === "rich" && "px-3.5 pt-3 pb-2.5")}>
          <p className="font-semibold">{message.title}</p>
          <p
            className={cn(
              "mt-0.5",
              theme.card === "rich" && "text-[#444746] dark:text-[#c4c7c5]",
            )}
          >
            {message.body}
          </p>
        </div>
        {message.actions.length ? (
          <ul
            aria-label="Card actions"
            className={cn(
              "flex flex-col",
              theme.card === "bubble" && "mt-2 -mx-3",
            )}
          >
            {message.actions.map((action) => (
              <li
                key={action}
                className={cn(
                  "border-t border-black/10 py-2 text-center font-medium dark:border-white/10",
                  theme.cardAction,
                )}
              >
                {action}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <li className={cn("flex flex-col", spaced && "mt-2.5")}>
      {speaker}
      {body}
    </li>
  );
}

function StatusBar({ channel }: { channel: EarlyAccessChannelId }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-9 shrink-0 items-center justify-between px-6 pt-1 text-[0.75rem] font-semibold",
        channel === "whatsapp"
          ? "bg-[#008069] text-white dark:bg-[#202c33] dark:text-[#e9edef]"
          : "text-black dark:text-white",
      )}
    >
      <span>9:41</span>
      <span className="flex items-center gap-1">
        <Signal className="size-3.5" />
        <Wifi className="size-3.5" />
        <BatteryFull className="size-4" />
      </span>
    </div>
  );
}

function Avatar({
  contact,
  className,
}: {
  contact: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        className,
      )}
    >
      {contact.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Header({
  channel,
  contact,
}: {
  channel: EarlyAccessChannelId;
  contact: string;
}) {
  if (channel === "whatsapp") {
    return (
      <div
        aria-hidden="true"
        className="flex h-12 shrink-0 items-center gap-2 bg-[#008069] px-2 text-white dark:bg-[#202c33] dark:text-[#e9edef]"
      >
        <ArrowLeft className="size-5" />
        <Avatar
          contact={contact}
          className="size-8 bg-[#dfe5e7] text-sm text-[#54656f]"
        />
        <span className="min-w-0 flex-1 truncate font-semibold">{contact}</span>
        <Video className="size-[1.125rem]" />
        <Phone className="ms-3 me-1 size-4" />
      </div>
    );
  }
  if (channel === "rcs") {
    return (
      <div
        aria-hidden="true"
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-[#e3e3e3] px-3 text-[#1f1f1f] dark:border-[#2d2f31] dark:text-[#e3e3e3]"
      >
        <ArrowLeft className="size-5" />
        <Avatar
          contact={contact}
          className="size-8 bg-[#0b57d0] text-sm text-white dark:bg-[#a8c7fa] dark:text-[#062e6f]"
        />
        <span className="flex min-w-0 flex-1 items-center gap-1 font-semibold">
          <span className="truncate">{contact}</span>
          <BadgeCheck className="size-4 shrink-0 text-[#0b57d0] dark:text-[#a8c7fa]" />
        </span>
      </div>
    );
  }
  // iMessage and SMS share Messages' centered header.
  return (
    <div
      aria-hidden="true"
      className="relative flex shrink-0 flex-col items-center gap-1 border-b border-black/10 bg-[#f6f6f6]/90 pt-1 pb-2 text-black dark:border-white/10 dark:bg-[#1c1c1e] dark:text-white"
    >
      <ChevronLeft className="absolute top-3 left-2 size-6 text-[#0068e0] dark:text-[#4d9fff]" />
      <Avatar
        contact={contact}
        className="size-10 bg-[#a4a4ab] text-base text-white dark:bg-[#5b5b60]"
      />
      <span className="text-[0.6875rem] leading-none">{contact}</span>
    </div>
  );
}

function Composer({ theme }: { theme: Theme }) {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center gap-2 px-3 pt-1 pb-5"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-[#6e6e73] dark:bg-white/10 dark:text-[#8e8e93]">
        <Plus className="size-4" />
      </span>
      <span
        className={cn(
          "flex h-9 flex-1 items-center justify-between rounded-full border px-3.5 text-[0.8125rem]",
          theme.composer,
        )}
      >
        {theme.composerLabel}
        <Mic className="size-4" />
      </span>
    </div>
  );
}
