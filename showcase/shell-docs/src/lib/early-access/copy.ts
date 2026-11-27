/*
  Every word on the four early-access channel landing pages on docs.copilotkit.ai (/imessage, /whatsapp, /sms, /rcs),
  in reading order. Each channel's name, its card line, and the "Early access" label live in ./channels, which every
  docs page loads; the rest is here, and only the landing page, its Markdown, its metadata, and its social card load it.

  - Write for the reader, a developer with an agent: what they get, in their words. Leave out how we got here
    (what a channel "builds on", which channels shipped first) and don't repeat that a page is in early access:
    the picker's badge and the "Get early access" button already say it.
  - The example conversations are illustrative, not customer data.
  - iMessage, SMS, and RCS have not shipped. Each hero names the channel features early access is built to
    support (set by the docs owner, November 27 2026); the copy never promises dates, prices, carriers, or coverage.
  - WhatsApp has an adapter today (@copilotkit/channels/whatsapp); managed WhatsApp on CopilotKit Intelligence is
    in early access. Its feature copy describes what the adapter does now.
*/

import { EARLY_ACCESS_CHANNEL_NAMES, EARLY_ACCESS_LABEL } from "./channels";
import type { EarlyAccessChannelId } from "./channels";

export type { EarlyAccessChannelId };

export type ConversationMessage =
  | { from: "person" | "agent"; kind: "text"; text: string }
  /** Agent message with reply buttons (WhatsApp) or suggested replies (RCS). */
  | { from: "agent"; kind: "choices"; text: string; choices: string[] }
  /** RCS rich card. */
  | {
      from: "agent";
      kind: "card";
      title: string;
      body: string;
      actions: string[];
    };

/** A link on words in a line of copy: the first `text` in the line links to `href` (a docs path). */
export interface TextLink {
  text: string;
  href: string;
}

/** A line of copy split around its links, in reading order, for the page and its Markdown. */
export function linkSegments(
  line: string,
  links: TextLink[] = [],
): { text: string; href?: string }[] {
  const found = links
    .map((link) => ({ ...link, at: line.indexOf(link.text) }))
    .filter((link) => link.at >= 0)
    .sort((a, b) => a.at - b.at);
  const segments: { text: string; href?: string }[] = [];
  let from = 0;
  for (const link of found) {
    // A link inside one already placed stays plain text.
    if (link.at < from) continue;
    if (link.at > from) segments.push({ text: line.slice(from, link.at) });
    segments.push({ text: link.text, href: link.href });
    from = link.at + link.text.length;
  }
  if (from < line.length) segments.push({ text: line.slice(from) });
  return segments;
}

export interface EarlyAccessChannelCopy {
  id: EarlyAccessChannelId;
  name: string; // "iMessage", "WhatsApp", "SMS", "RCS": from ./channels
  meta: { title: string; description: string }; // title <= 60 chars, description <= 132 chars (the social card cuts it there)
  hero: { title: string; lede: string }; // H1 <= 8 words; lede 1-2 sentences: connect any agent, then what the channel supports
  booking: {
    heading: string; // "Book a 25-minute iMessage demo"
    buildingLabel: string; // the optional question, e.g. "What should your agent do in iMessage?"
    buildingPlaceholder: string;
  };
  conversation: { contact: string; messages: ConversationMessage[] }; // 4-6 messages, a realistic use case, channel-appropriate kinds only (SMS and iMessage: text only; WhatsApp: text + choices; RCS: text + card + choices)
  features: { title: string; body: string }[]; // exactly 3: what you get with CopilotKit in this channel
  specifics: { title: string; body: string; links?: TextLink[] }[]; // exactly 3: facts unique to this channel
  howItWorksNote?: { text: string; links?: TextLink[] }; // one line under "How it works", where the channel also works another way today
  closing: { title: string; body: string };
}

export const EARLY_ACCESS_CHANNEL_COPY: Record<
  EarlyAccessChannelId,
  EarlyAccessChannelCopy
> = {
  /* Use case: a customer moves a service appointment. Text only. */
  imessage: {
    id: "imessage",
    name: EARLY_ACCESS_CHANNEL_NAMES.imessage,
    meta: {
      title: "Bring your AI agent to iMessage (early access) | CopilotKit",
      description:
        "Connect any agent to iMessage with AG-UI: typing indicators, reactions, polls, images, and generative UI. Book a demo.",
    },
    hero: {
      title: "Bring your agent to iMessage",
      lede: "Connect any agent to iMessage with AG-UI. It supports typing indicators, emoji reactions, polls, images, generative UI, and more.",
    },
    booking: {
      heading: "Book a 25-minute iMessage demo",
      buildingLabel: "What should your agent do in iMessage?",
      buildingPlaceholder:
        "For example, let customers reschedule appointments and check on a booking",
    },
    conversation: {
      contact: "Service center",
      messages: [
        {
          from: "person",
          kind: "text",
          text: "Hi, can I move my service appointment to Thursday?",
        },
        {
          from: "agent",
          kind: "text",
          text: "Sure. You're booked Tuesday at 9:00 AM for an oil change. Thursday has 8:30 AM or 2:00 PM open.",
        },
        { from: "person", kind: "text", text: "2 works" },
        {
          from: "agent",
          kind: "text",
          text: "You're set for Thursday at 2:00 PM. Your loaner car request moved with it.",
        },
      ],
    },
    features: [
      {
        title: "Actions in your systems",
        body: "Your agent calls your own code. It can look up a booking, check open times, and move an appointment.",
      },
      {
        title: "Knows who is asking",
        body: "Map each sender to a user in your app, so your agent knows whose appointment it is.",
      },
      {
        title: "One agent, every channel",
        body: "The agent that answers in iMessage is the one in your web app, your mobile app, Slack, and Teams. You build it once.",
      },
    ],
    specifics: [
      {
        title: "Built into Apple devices",
        body: "Messages comes with every iPhone, iPad, and Mac. There is no app to download and no account to create.",
      },
      {
        title: "The app they already text from",
        body: "Your agent's conversation sits in the same Messages list as everyone else they text, not in a separate app or portal.",
      },
      {
        title: "For people on Apple devices",
        body: "iMessage runs between Apple devices. For Android phones, see SMS and RCS.",
        links: [
          { text: "SMS", href: "/sms" },
          { text: "RCS", href: "/rcs" },
        ],
      },
    ],
    closing: {
      title: "Messages is already on every iPhone, iPad, and Mac",
      body: "Book a demo and talk through what your agent should do in iMessage.",
    },
  },

  /* Use case: order status and a delivery change, with reply buttons. Button titles stay within WhatsApp's 20
     characters, and no message carries more than three. */
  whatsapp: {
    id: "whatsapp",
    name: EARLY_ACCESS_CHANNEL_NAMES.whatsapp,
    meta: {
      title: "Bring your AI agent to WhatsApp | CopilotKit",
      description:
        "Connect any agent to WhatsApp with AG-UI: reply buttons, lists, approvals, photos, and voice messages. Book a demo.",
    },
    hero: {
      title: "Bring your agent to WhatsApp",
      lede: "Connect any agent to WhatsApp with AG-UI. It supports reply buttons, lists, approvals, photos, voice messages, generative UI, and more.",
    },
    booking: {
      heading: "Book a 25-minute WhatsApp demo",
      buildingLabel: "What should your agent do on WhatsApp?",
      buildingPlaceholder:
        "For example, answer order questions and let customers change a delivery",
    },
    conversation: {
      contact: "Order support",
      messages: [
        { from: "person", kind: "text", text: "Hi, where's my order?" },
        {
          from: "agent",
          kind: "choices",
          text: "Order 2391 ships today and arrives Friday between 9 AM and 1 PM.",
          choices: ["Change the day", "Change address", "All good"],
        },
        { from: "person", kind: "text", text: "Change the day" },
        {
          from: "agent",
          kind: "choices",
          text: "Saturday between 10 AM and 2 PM is open. Want me to move it?",
          choices: ["Move to Saturday", "Keep Friday"],
        },
        { from: "person", kind: "text", text: "Move to Saturday" },
        {
          from: "agent",
          kind: "text",
          text: "Done. Order 2391 now arrives Saturday between 10 AM and 2 PM.",
        },
      ],
    },
    features: [
      {
        title: "Reply buttons and lists",
        body: "Your agent's choices appear as reply buttons, or as a list when there are more than three.",
      },
      {
        title: "Approvals in the chat",
        body: "When your agent needs a yes before it acts, it posts the choice as buttons and carries on with the customer's answer.",
      },
      {
        title: "Photos, voice, and files",
        body: "Customers can send photos, voice messages, and documents, and your agent can read them.",
      },
    ],
    specifics: [
      {
        title: "The 24-hour window",
        body: "A customer's message opens a 24-hour window for replies. Messages you start outside it need approved templates.",
      },
      {
        title: "A business phone number",
        body: "Customers write to your business phone number on WhatsApp, like any other contact.",
      },
      {
        title: "Replies arrive whole",
        body: "WhatsApp can't edit a sent message, so your agent's reply arrives complete, not word by word.",
      },
    ],
    howItWorksNote: {
      text: "Prefer to hold the WhatsApp credentials yourself? The WhatsApp adapter is available today.",
      links: [
        {
          text: "WhatsApp adapter",
          href: "/reference/channels/sdk/direct-adapters#whatsapp",
        },
      ],
    },
    closing: {
      title: "Your agent can answer on WhatsApp today",
      body: "Book a demo and talk through what your agent should do on WhatsApp.",
    },
  },

  /* Use case: field-service dispatch, a technician texting between jobs. Text only. */
  sms: {
    id: "sms",
    name: EARLY_ACCESS_CHANNEL_NAMES.sms,
    meta: {
      title: "Bring your AI agent to SMS (early access) | CopilotKit",
      description:
        "Connect any agent to SMS with AG-UI and reach any mobile phone, with no app to install. Book a demo.",
    },
    hero: {
      title: "Bring your agent to SMS",
      lede: "Connect any agent to SMS with AG-UI. It reaches any mobile phone, with no app to install and no account to create.",
    },
    booking: {
      heading: "Book a 25-minute SMS demo",
      buildingLabel: "What should your agent do over SMS?",
      buildingPlaceholder:
        "For example, keep field technicians on schedule and log finished jobs",
    },
    conversation: {
      contact: "Dispatch",
      messages: [
        {
          from: "person",
          kind: "text",
          text: "Done at 18 Alder St. Replaced the blower motor.",
        },
        {
          from: "agent",
          kind: "text",
          text: "Logged on job 4471. Next: 2:30 PM at 9 Birch Ave, AC not cooling. Gate code 2741.",
        },
        { from: "person", kind: "text", text: "Running 20 min late" },
        {
          from: "agent",
          kind: "text",
          text: "Got it. I moved your arrival to 2:50 PM and let the customer know.",
        },
      ],
    },
    features: [
      {
        title: "Real work, by text",
        body: "Your agent calls your own code. It can log a finished job, read the schedule, and move the next arrival.",
      },
      {
        title: "Context in every reply",
        body: "Each conversation keeps its history, so a two-word reply still lands in context.",
      },
      {
        title: "Knows who is texting",
        body: "Map each sender to a person in your system. The agent then answers with their jobs, their schedule, and their permissions.",
      },
    ],
    specifics: [
      {
        title: "Any mobile phone",
        body: "SMS reaches any mobile phone, from a new smartphone to a basic flip phone, with nothing to install.",
      },
      {
        title: "No data connection needed",
        body: "Texts travel over the cellular network rather than mobile data, so they get through where data is slow or unavailable.",
      },
      {
        title: "Plain text only",
        body: "SMS has no buttons or cards. The agent asks and confirms in words, so short, clear replies matter.",
      },
    ],
    closing: {
      title: "Every mobile phone can already text",
      body: "Book a demo and talk through what your agent should do over SMS.",
    },
  },

  /* Use case: a traveler moves to an earlier flight from a rich card, then gets suggested replies. Card actions and
     suggested replies stay within RCS's 25 characters. */
  rcs: {
    id: "rcs",
    name: EARLY_ACCESS_CHANNEL_NAMES.rcs,
    meta: {
      title: "Bring your AI agent to RCS (early access) | CopilotKit",
      description:
        "Connect any agent to RCS with AG-UI: rich cards, carousels, suggested replies, and generative UI. Book a demo.",
    },
    hero: {
      title: "Bring your agent to RCS",
      lede: "Connect any agent to RCS with AG-UI. It supports rich cards, carousels, suggested replies, typing indicators, images, generative UI, and more.",
    },
    booking: {
      heading: "Book a 25-minute RCS demo",
      buildingLabel: "What should your agent do in RCS?",
      buildingPlaceholder:
        "For example, help travelers change flights and find their boarding pass",
    },
    conversation: {
      contact: "Travel desk",
      messages: [
        {
          from: "person",
          kind: "text",
          text: "Any earlier flights to Denver tomorrow?",
        },
        {
          from: "agent",
          kind: "card",
          title: "SFO to DEN, 7:05 AM",
          body: "Tomorrow, nonstop. Arrives 10:40 AM. Same fare as your current ticket.",
          actions: ["Switch to this flight", "See other times"],
        },
        { from: "person", kind: "text", text: "Switch to this flight" },
        {
          from: "agent",
          kind: "choices",
          text: "You're on the 7:05 AM to Denver tomorrow, seat 14C. Anything else?",
          choices: ["Send boarding pass", "That's all"],
        },
      ],
    },
    features: [
      {
        title: "Answers from your systems",
        body: "Your agent calls your own code. It can search flights, hold a seat, and change a booking.",
      },
      {
        title: "A yes before it acts",
        body: "Your agent can pause for an approval, then carry on with the person's answer.",
      },
      {
        title: "Generative UI, natively",
        body: "Describe a message once. It appears as a rich card or suggested replies in RCS, and as native UI in every other channel.",
      },
    ],
    specifics: [
      {
        title: "Rich cards and carousels",
        body: "A business message can be a rich card with an image, text, and buttons. Several cards can sit side by side in a carousel.",
      },
      {
        title: "Suggested replies",
        body: "People can tap a suggested reply instead of typing, so a choice takes one tap.",
      },
      {
        title: "Verified business senders",
        body: "On Android, business messages come from a verified sender that shows the brand's name and logo.",
      },
    ],
    closing: {
      title: "RCS was built for more than plain text",
      body: "Book a demo and talk through what your agent should do in RCS.",
    },
  },
};

/** Copy shared by all four pages. `{channel}` is replaced with the channel name. */
export const SHARED_EARLY_ACCESS_COPY: {
  eyebrow: string; // "Early access"
  primaryCta: string; // "Get early access"
  secondaryCta: string; // link to the Channels overview
  bookingNote: string; // one line under the booker's heading: who the call is with
  conversationTitle: string; // section heading over the phone preview
  conversationLede: string; // one line under it
  featuresTitle: string;
  howItWorks: {
    title: string;
    lede: string;
    steps: { title: string; body: string }[];
  }; // 4 steps: person in {channel} -> CopilotKit Intelligence -> the Channels SDK -> your AG-UI agent
  specificsTitle: string; // e.g. "Why {channel}"
  otherChannelsTitle: string;
} = {
  eyebrow: EARLY_ACCESS_LABEL,
  primaryCta: "Get early access",
  secondaryCta: "Explore the Channels SDK",
  bookingNote: "Talk through your use case with a CopilotKit engineer.",
  /* `{channel}` never follows "a" or "an": "an SMS" and "a WhatsApp" need different articles. */
  conversationTitle: "Meet your users where they are",
  conversationLede: "With a unified interface for your agent.",
  featuresTitle: "What CopilotKit brings to {channel}",
  howItWorks: {
    title: "How it works",
    lede: "The Channels SDK brings your agent to messaging apps, for one experience across web, mobile, Slack, Teams, iMessage, WhatsApp, and more. Your agent, its tools, and your data stay in your infrastructure.",
    steps: [
      {
        title: "The {channel} conversation",
        body: "A person messages your agent the way they message anyone else.",
      },
      {
        title: "CopilotKit Intelligence",
        body: "Holds the {channel} connection and its credentials, and delivers each message to your process.",
      },
      {
        title: "The Channels SDK",
        body: "Runs in your process. It runs your agent, calls your tools, and sends the reply back.",
      },
      {
        title: "Your AG-UI agent",
        body: "Build it with LangGraph, Mastra, CrewAI, Google ADK, Pydantic AI, or another supported framework. Its tools and business logic stay with you.",
      },
    ],
  },
  specificsTitle: "What makes {channel} different",
  otherChannelsTitle: "Other channels",
};
