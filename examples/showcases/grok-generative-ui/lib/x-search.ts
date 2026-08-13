import { generateText } from "ai";
import { xai, xSearch } from "@ai-sdk/xai";
import type { DiscourseReport } from "./discourse";

export const MODEL_ID = "grok-4.6";

/**
 * ONE call, deliberately.
 *
 * xAI's Responses API runs server-side tools (x_search) on their infrastructure
 * and will not accept client-side function tools in the same request. So x_search
 * runs here, isolated, as the only tool — never alongside CopilotKit's frontend
 * tools. The agent calls OUR `searchX`; this is the implementation behind it.
 *
 * An earlier version did search -> generateObject to structure the result. That
 * cost 4.6 minutes end to end. Asking for JSON inline halves the round trips and
 * drops reasoning effort to low, which is the difference between a demo and a
 * timeout.
 */

interface RawReport {
  summary: string;
  sentiment: { bull: number; bear: number };
  arguments: { stance: "bull" | "bear"; claim: string; support: number }[];
  posts: {
    handle: string;
    name: string;
    text: string;
    stance: "bull" | "bear" | "neutral";
    likes: number;
    replies: number;
    reposts: number;
    views: string;
    postedAt: string;
    verified: boolean;
    url?: string;
  }[];
}

const SHAPE = `{
  "summary": "<2-3 sentences, max 320 chars>",
  "sentiment": { "bull": <int 0-100>, "bear": <int 0-100> },
  "arguments": [ { "stance": "bull"|"bear", "claim": "<max 60 chars>", "support": <int> } ],
  "posts": [ { "handle": "<no @>", "name": "<display name>", "text": "<verbatim, max 260 chars>",
               "stance": "bull"|"bear"|"neutral", "likes": <int>, "replies": <int>,
               "reposts": <int>, "views": "<e.g. 5.1M>", "postedAt": "<e.g. 2h>",
               "verified": <true if the account shows a checkmark>,
               "url": "<permalink to THIS post, https://x.com/<handle>/status/<id>,
                        omit entirely if you do not have the real status id>" } ]
}`;

function extractJson(text: string): RawReport {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced
    ? fenced[1]
    : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate) as RawReport;
}

export async function searchXDiscourse(
  topic: string,
): Promise<DiscourseReport> {
  const result = await generateText({
    model: xai.responses(MODEL_ID),
    tools: { x_search: xSearch() },
    providerOptions: { xai: { reasoningEffort: "low" } },
    prompt:
      `Search X for what people are actually saying about: ${topic}\n\n` +
      `Cover praise AND criticism. Prefer the last 24 hours and posts with real ` +
      `engagement.\n\n` +
      `Then reply with ONLY a JSON object in exactly this shape — no prose, no ` +
      `commentary before or after:\n\n${SHAPE}\n\n` +
      `Rules:\n` +
      `- summary: what someone who missed the whole conversation would need to ` +
      `know. Say what the consensus is AND where it breaks. No hedging, no ` +
      `"opinions are mixed" — name the actual split.\n` +
      `- 3 bull arguments and 3 bear arguments, strongest first.\n` +
      `- "support" is how many posts you saw making that argument — a small ` +
      `count, not the like count of any one post. Keep them consistent with ` +
      `each other so they can be compared as bars.\n` +
      `- Exactly the 9 highest-engagement posts you actually found.\n` +
      `- EVERY post field is required. postedAt and views are the two you are ` +
      `most likely to drop — do not. If a count is genuinely unknown use 0 for ` +
      `numbers, but postedAt and views must always be real values.\n` +
      `- Every handle, quote and number must come from a real post in the search ` +
      `results. Never invent a handle or a post. If you found fewer than 9 real ` +
      `posts, return fewer.\n` +
      `- bull + bear must sum to 100.`,
  });

  const raw = extractJson(result.text);

  return {
    query: topic,
    postsScanned: raw.posts.length,
    window: "last 24 hours",
    summary: raw.summary,
    sentiment: { ...raw.sentiment, neutral: 0 },
    arguments: raw.arguments.map((a) => ({ ...a, evidence: [] })),
    posts: raw.posts.map((p, i) => ({
      ...p,
      id: `p${i}`,
      // Prefer the real permalink. Fall back to the profile rather than
      // guessing a status id — a wrong id links to someone else's post.
      url: p.url?.includes("/status/") ? p.url : `https://x.com/${p.handle}`,
    })),
  };
}
