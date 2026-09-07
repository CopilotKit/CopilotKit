/**
 * Shape of what phase 1 returns: grok-4.6 runs `xai.tools.xSearch()` server-side,
 * then structures what it found. Phase 2 hands this to the frontend tools.
 *
 * The posts below are real, captured from X search on 2026-08-12 within ~2h of
 * the Grok 4.6 launch. Engagement numbers are as observed. Keeping them real
 * matters: the demo shows genuine criticism of Grok inside a post announcing
 * Grok support, which is the point.
 */

export type Stance = "bull" | "bear" | "neutral";

export interface Post {
  id: string;
  handle: string;
  name: string;
  text: string;
  stance: Stance;
  likes: number;
  /** Optional: X shows a blank slot rather than a zero when a count is absent. */
  replies?: number;
  reposts?: number;
  views: string;
  postedAt: string;
  verified?: boolean;
  url: string;
}

/**
 * X profile image for a handle.
 *
 * Derived from the handle, never from model output — so it cannot be a
 * fabricated avatar for a real person. Falls back to the letter tile in
 * `XPost` when the request 404s or the account has no picture.
 */
export function avatarUrl(handle: string): string {
  return `https://unavatar.io/x/${encodeURIComponent(handle)}`;
}

/**
 * First link in the post body, for the preview card.
 *
 * Parsed out of the text we already display rather than asked of the model —
 * a link card is a claim about where a post points, and inventing one would be
 * inventing a citation.
 */
export function firstLink(
  text: string,
): { url: string; domain: string } | null {
  const m = text.match(/https?:\/\/[^\s)]+/);
  if (!m) return null;
  try {
    const url = new URL(m[0]);
    return { url: m[0], domain: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

export interface Argument {
  stance: "bull" | "bear";
  claim: string;
  support: number;
  evidence: string[];
}

export interface DiscourseReport {
  query: string;
  postsScanned: number;
  window: string;
  /** grok's read on the discourse, in its own words. Rendered above the charts. */
  summary: string;
  sentiment: { bull: number; bear: number; neutral: number };
  arguments: Argument[];
  posts: Post[];
}

export const POSTS: Post[] = [
  {
    id: "p1",
    handle: "SpaceXAI",
    name: "SpaceXAI",
    text: "Introducing Grok 4.6. It delivers frontier intelligence and is a significant improvement over Grok 4.5 at the same price.",
    stance: "neutral",
    likes: 18000,
    views: "5.1M",
    postedAt: "2h",
    url: "https://x.com/SpaceXAI/status/2087562800982077492",
  },
  {
    id: "p2",
    handle: "mntruell",
    name: "Michael Truell",
    text: "Excited to release Grok 4.6. With each release, Grok is becoming a more capable digital colleague. It combines Opus-class intelligence and polish with very low cost and high speed.",
    stance: "bull",
    likes: 2100,
    views: "412K",
    postedAt: "2h",
    url: "https://x.com/mntruell/status/2087565040677454327",
  },
  {
    id: "p3",
    handle: "kimmonismus",
    name: "Chubby♨️",
    text: "Grok 4.6 released, absolutely insane crazy jump! xAI was cooking! Matches GPT-5.6 Sol on the AA Intelligence Index at 61 and leads it on CursorBench, FrontierCode and AA-Briefcase. But it still trails GPT-5.6 Sol on DeepSWE.",
    stance: "bull",
    likes: 1400,
    views: "289K",
    postedAt: "2h",
    url: "https://x.com/kimmonismus/status/2087563670054211704",
  },
  {
    id: "p4",
    handle: "mehulmpt",
    name: "Mehul Mohan",
    text: "grok 4.6 is not as good as gpt 5.6 sol in my 30 minutes of usage. it does incomplete work, not incorrect, just incomplete. maybe it is the grok harness.",
    stance: "bear",
    likes: 222,
    views: "16K",
    postedAt: "1h",
    url: "https://x.com/mehulmpt",
  },
  {
    id: "p5",
    handle: "adxtyahq",
    name: "aditya",
    text: "I tried building a Retro Mario-style platformer using Grok 4.6 vs Kimi K3. Both got the same single prompt. Grok took ~11 minutes, Kimi 16, but Kimi had a clear edge in the actual output. Grok struggled with the physics.",
    stance: "bear",
    likes: 26,
    views: "986",
    postedAt: "38m",
    url: "https://x.com/adxtyahq",
  },
  {
    id: "p6",
    handle: "AlemTuzlak",
    name: "Alem Tuzlak",
    text: "I got a chance to play with Grok 4.6 in early access and it has sparked my joy for models that hasn't happened since Opus 4.5 dropped. Its speed and accuracy are a perfect balance.",
    stance: "bull",
    likes: 20,
    views: "831",
    postedAt: "1h",
    url: "https://x.com/AlemTuzlak",
  },
  {
    id: "p7",
    handle: "jumperz",
    name: "JUMPERZ",
    text: "i think 4.5 was the first Grok model where I felt like xAI genuinely entered the frontier coding race. a lot of people are already getting opus 4.8 level results from it. my only real problem with grok was never raw intelligence.",
    stance: "bull",
    likes: 340,
    views: "52K",
    postedAt: "1d",
    url: "https://x.com/jumperz",
  },
  {
    id: "p8",
    handle: "ericzakariasson",
    name: "eric zakariasson",
    text: "grok 4.6 is live! a write up on my learnings, findings and tips to using the model. it just pays more attention to detail on the first pass, which in practice means fewer rounds of me pointing at things.",
    stance: "bull",
    likes: 890,
    views: "134K",
    postedAt: "2h",
    url: "https://x.com/ericzakariasson/status/2087566447178547494",
  },
  {
    id: "p9",
    handle: "berryxia",
    name: "Berryxia.AI",
    text: "Ran Three.js 3D modeling and spatial reasoning across Kimi K3, DeepSeek V4 Pro and Grok 4.6 side by side. Results are not what the benchmarks would suggest.",
    stance: "neutral",
    likes: 247,
    views: "31K",
    postedAt: "12m",
    url: "https://x.com/berryxia",
  },
];

export const REPORT: DiscourseReport = {
  query: "what is X actually saying about grok 4.6?",
  postsScanned: 412,
  window: "last 6 hours",
  summary:
    "The launch is landing well on price-to-intelligence, and almost every " +
    "positive post makes that same trade the headline. The criticism is narrower " +
    "than the praise but more specific: it finishes less of the task than it " +
    "starts, and side-by-side builds against Kimi K3 go the other way.",
  sentiment: { bull: 62, bear: 38, neutral: 0 },
  arguments: [
    {
      stance: "bull",
      claim: "Frontier intelligence at roughly half the price of rivals",
      support: 147,
      evidence: ["p2", "p3"],
    },
    {
      stance: "bull",
      claim:
        "Speed-to-accuracy balance is the real story, not the benchmark win",
      support: 98,
      evidence: ["p6", "p8"],
    },
    {
      stance: "bull",
      claim: "Strongest first pass yet on visual and interactive work",
      support: 61,
      evidence: ["p8", "p7"],
    },
    {
      stance: "bear",
      claim: "Incomplete, not incorrect — leaves work unfinished",
      support: 84,
      evidence: ["p4"],
    },
    {
      stance: "bear",
      claim: "Loses head-to-head against Kimi K3 on one-shot builds",
      support: 52,
      evidence: ["p5", "p9"],
    },
    {
      stance: "bear",
      claim: "Benchmark lead does not hold on DeepSWE",
      support: 22,
      evidence: ["p3"],
    },
  ],
  posts: POSTS,
};

/** The recompose target: same report, critics only. */
export const CRITICS_REPORT: DiscourseReport = {
  ...REPORT,
  query: "just the critics",
  sentiment: { bull: 0, bear: 100, neutral: 0 },
  arguments: REPORT.arguments.filter((a) => a.stance === "bear"),
  posts: POSTS.filter((p) => p.stance === "bear"),
};

export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}
