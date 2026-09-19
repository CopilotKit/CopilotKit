# Agentic Kit

A brainstorm, not a decision. Everything here is a strawman written to be argued with.

Status: exploration · Owner: Jerel · Date: 2026-09-19

---

## The thesis in one paragraph

CopilotKit makes agents that **help a user do their work**. OpenBot makes agents that **do a
company's work alongside its employees**. Neither makes the thing a growing number of teams are
actually trying to ship: an agent that **is the product**, that a **stranger** talks to, that
**runs the conversation rather than answering it**, and that **produces an artifact** when the
conversation ends. An AI executive coach that interviews your users is not a copilot with a
microphone bolted on. It is a different control structure, a different trust model, and a
different definition of "done." Agentic Kit is the repo for that.

---

## 1. Where it sits

The three-way split, stated as the axis that actually separates them:

| | Who it talks to | What it is to them | Who drives the conversation | What "done" means |
| --- | --- | --- | --- | --- |
| **CopilotKit** | Your user, inside your app | A tool in the corner | The human | The human closes the panel |
| **OpenBot** | Your employees, inside your walls | A coworker with a desk | Either, governed | The task is completed |
| **Agentic Kit** | Your customer, as the product | The experience itself | **The agent** | **An outcome exists** |

The column that matters is the third one. Everything CopilotKit and OpenBot do assumes a human
initiates a turn and the agent responds. An executive coach, a user-research interviewer, an intake
screener, a discovery call — these **conduct**. The agent holds the agenda, decides when a thread
has been explored enough, decides when to press and when to move on, and decides when it is
finished. That inversion is the product.

A second, softer axis: **CopilotKit and OpenBot are both inside a trust boundary.** The user is
logged in and is yours. Agentic Kit's participant is a stranger with a link. That single fact
rewrites identity, consent, abuse, cost control, and data retention — and it is the reason this
does not fit cleanly as a folder inside either existing repo.

---

## 2. What is actually missing today (checked against the code, not assumed)

I read the repo rather than guessing. The honest state of voice in CopilotKit:

- `@copilotkit/voice` exports exactly **one** symbol: `TranscriptionServiceOpenAI`.
- The runtime abstraction is `TranscriptionService` with a single method — `transcribeFile()`.
  File in, string out. Not a stream.
- The client side is `CopilotChatAudioRecorder.tsx` and `use-push-to-talk.tsx`: `getUserMedia` →
  `MediaRecorder` → upload a blob → Whisper → **insert the text into the chat input**.
- `grep -ri webrtc packages/` returns **nothing**. No `RTCPeerConnection`, no audio worklet, no
  streaming decode, no TTS anywhere in the tree.

So: **CopilotKit's voice support today is a better keyboard.** Speech in, text into a box, the
normal text loop from there. There is no speech *out*, no streaming audio *in*, no turn detection,
no barge-in, no realtime session, no latency budget. Voice-to-voice is not a repackaging of
something we have. It is net-new, and that is a point in favor of giving it its own home rather
than smuggling it into `packages/voice`.

What *does* already exist and is worth reusing hard:

- **AG-UI** — the event protocol. Framework-neutral, already adopted outside our org.
- **Channels** (`channels-slack`, `-teams`, `-discord`, `-whatsapp`, `-telegram`) — the precedent
  that an agent can live on a surface that isn't our React tree. WhatsApp and Telegram are already
  consumer-facing, which means the "outward" boundary is partly crossed already.
- **Generative UI + shared state + HITL interrupts** — the actual crown jewels. See §4.
- **Intelligence** — threads, memories, learning, analytics. An engagement product needs all four,
  and needs them more than a copilot does.
- **OpenBot's repo shape** — template-not-product, MIT, compose up, YAML config-as-code, an
  `examples/<tenant>/` package you replace, "talk to an engineer" as the GTM. That motion
  demonstrably worked. Copy it.

---

## 3. The core insight: conducting, not assisting

A copilot is a **reactive loop**: wait for input, respond, wait. An engagement is a **plan being
executed by the agent against a person**, and it needs primitives a chat loop does not have:

1. **An agenda.** Not a system prompt — a structured set of objectives with coverage state. "Find
   out how they currently handle X. Probe for a specific recent example. Do not accept a
   generality." The agent knows which objectives are covered, which are thin, and what is left.
2. **Depth control.** When to follow up versus when to move on. A copilot never has to decide this;
   an interviewer decides it every thirty seconds, and it is the whole difference between a good
   interviewer and a form with a voice.
3. **A stop condition.** The engagement ends because the agenda is covered, or time ran out, or the
   participant disengaged — not because someone closed a tab. The agent must know it is done and
   say so.
4. **An outcome artifact.** The conversation is the *means*. The product is the structured thing
   that falls out: the coaching summary, the research writeup with quotes, the qualified lead, the
   triage decision. This must be typed, schema-validated, and extracted under rules about what may
   be claimed. OpenBot's `interview-notes` coworker already encodes exactly this discipline — keep
   question, answer, and observation apart; never promote an impression into evidence — and it is
   the single most transferable idea in that repo.
5. **Resumability across a gap.** A coaching relationship is many sessions. The agent needs to open
   session four knowing what was committed to in session three and whether it happened. That is
   Intelligence memories doing real work, not a nice-to-have.

None of the five are chat features. They are why this is a different kit.

---

## 4. The unfair advantage: voice that can show you things

This is the part nobody else has, and it should be the headline.

Every voice-agent platform in the market is a **transport**: audio in, audio out, a webhook in the
middle. The conversation is blind. If the agent needs you to choose among five options it has to
*read them to you*, which is terrible.

CopilotKit's entire existing competence is **agents that render UI**. Put those together:

- The coach asks "where would you put yourself on delegation, one to ten?" **and renders a slider.**
  You drag it while you talk. The agent sees the value change in shared state and responds to it.
- The researcher asks about pricing **and puts the pricing table on screen** to watch you react.
- The intake agent asks for your policy number **and renders a field**, because reading a
  seventeen-character alphanumeric aloud is a failure mode, not an interaction.
- The coach closes by **rendering the commitment card it just drafted** and asking you to edit it
  before it saves — HITL, which CopilotKit already has as `interrupt`.

The pitch writes itself: **"Voice agents that can draw."** Or: the conversation is voice, the
precision is visual. That is a category line, it is true, it is defensible, and it falls directly
out of assets we already own. Everything else in this document is arguable. I would not ship this
repo without this being the demo on the README.

---

## 5. Core primitives (strawman vocabulary)

Naming is load-bearing; these are proposals.

**Engagement** — one agent-led conversation with one participant, with a lifecycle:
`invited → joined → conducting → completing → completed | abandoned | ended`.
The central noun. Everything hangs off it.

**Agenda** — what the agent is trying to accomplish, as data. Objectives, probes, guardrails,
ordering hints, stop conditions. Authored as YAML (OpenBot precedent) or as code.

**Participant** — the person. Explicitly *not* a tenant user. Pseudonymous by default, identified
by an opaque invite token, optionally linked to a real record by the host application.

**Outcome** — the typed artifact. Declared as a schema up front; the agent fills it during and after
the engagement; extraction rules constrain what it may assert.

**Surface** — where the engagement happens: embedded widget, hosted link, phone, WhatsApp. The
existing channels concept generalized to voice.

**Session budget** — wall-clock and money. First-class, not an afterthought (see §9).

### What a developer writes

```ts
import { defineAgenda, defineOutcome } from "@agentickit/core";
import { z } from "zod";

const outcome = defineOutcome({
  schema: z.object({
    themes: z.array(z.object({
      theme: z.string(),
      evidence: z.array(z.string()).min(1),  // must quote the participant
      confidence: z.enum(["stated", "implied"]),
    })),
    notCovered: z.array(z.string()),          // say what you failed to get
  }),
  rules: [
    "Every theme carries at least one direct quote. No quote, no theme.",
    "An impression is not evidence. Record it as implied or not at all.",
    "Name what was not covered rather than leaving a silence.",
  ],
});

export const coach = defineAgenda({
  id: "exec-coach-intake",
  persona: "A direct, warm executive coach. You ask one question at a time and you wait.",
  objectives: [
    { id: "delegation", goal: "How do they currently delegate?",
      require: "one specific recent example, with names of the things delegated",
      ui: { onAsk: "DelegationScale" } },       // renders while it asks
    { id: "friction",   goal: "What did they try that did not work?",
      dependsOn: "delegation" },
  ],
  stopWhen: { allObjectives: "covered", orAfter: "25m" },
  outcome,
});
```

And on the surface:

```tsx
<Engagement agenda="exec-coach-intake" invite={token} mode="voice">
  <EngagementStage />        {/* the agent's rendered UI */}
  <EngagementTranscript />   {/* live, correctable */}
</Engagement>
```

The `ui.onAsk` line is §4 made concrete, and it is the API I would prototype first, because if that
feels good the whole thesis holds and if it feels bad the thesis is wrong.

---

## 6. The architectural fork you have to pick

**This is the real decision in the document.** AG-UI is event-based over SSE — server-to-client,
one direction, text-shaped. Voice-to-voice needs bidirectional, continuous, low-latency audio with
sub-300ms turn latency. Three options:

**(a) Extend AG-UI with audio event types.** One protocol, one mental model, channels and inspector
get voice for free. But you are pushing binary frames through a protocol designed for JSON events
over SSE, you will need a WebSocket or WebRTC transport binding anyway, and you would be changing a
protocol that other organizations have adopted — which is a slow, political process you do not
control.

**(b) Run a parallel realtime plane and sync.** WebRTC (or WebSocket) carries audio directly between
the browser and a realtime gateway; AG-UI continues to carry everything that is *not* audio — tool
calls, state deltas, generative UI, interrupts, the transcript as it finalizes. The two planes share
a session id and a clock. AG-UI stays untouched and keeps working for text engagements.

**(c) Don't own the transport.** Sit on LiveKit or Pipecat for media and spend all our effort on the
agenda/outcome/UI layer above it.

**My recommendation: (b), with (c) as the v0 implementation.** Define our own session contract so we
are not locked in, but implement the first version on an existing media stack rather than writing a
jitter buffer. The moat is the agenda, the outcome, and the generative UI over voice — not the RTP.
Owning the transport is how you spend a year building something Twilio already sells.

Sketch:

```
Participant browser
   ├── WebRTC (audio in/out) ────────► Realtime gateway ──► speech model
   └── AG-UI over SSE (everything else) ──► Runtime ──► your agent
                                                │
        transcript · tool calls · gen-UI · state · interrupts · outcome
```

The interesting engineering is in the seam: when the agent renders a component mid-utterance, when
the participant interrupts while a tool is running, and how the transcript stays the single source
of truth when audio and events arrive on two paths with different latencies.

---

## 7. Repo shape

Follow OpenBot closely; it is a proven shape and the deviations should be deliberate.

```
agentic-kit/
  app/            participant surface — hosted session page + embeddable widget
  console/        operator surface — author agendas, review transcripts, read outcomes
  server/         API, CopilotKit runtime, invites, consent, budgets, outcome store
  gateway/        realtime plane: media, turn detection, barge-in, transcript fan-out
  agent-*/        example AG-UI agents (built-in, LangGraph, Mastra, hand-written)
  examples/       the tenant package you replace — agendas, brand, outcome schemas
  docs/
```

Two surfaces instead of OpenBot's one, and that is the structural difference: **OpenBot's user and
operator are the same person; here they are not.** The participant sees a branded session and
nothing else. The operator never joins the call — they read the outcomes. The console is where the
product value is legible, and I suspect it is where the paid tier lives.

`examples/` as config-as-code, in OpenBot's style:

```yaml
# examples/coaching/agendas/leadership-intake.yaml
id: leadership-intake
name: Leadership Intake
mode: voice
persona: >-
  A direct, warm executive coach. One question at a time. You wait through silence.
  You never give advice in the intake session; you are here to understand.
objectives:
  - id: delegation
    goal: Understand how they currently delegate.
    require: A specific recent example, with the actual work named.
    ui: DelegationScale
consent:
  recording: required
  transcript_visible_to_participant: true
stop_when:
  all_objectives: covered
  or_after: 25m
outcome: leadership-intake-summary
```

---

## 8. What ships in the box

OpenBot shipped thirteen coworkers and that was the right call — it made an abstract platform
concrete in ten seconds of reading. Do the same with **four to six engagements**, each a different
shape so the range is visible:

1. **Executive coach** — the hero. Multi-session, memory across sessions, commitments tracked,
   voice-to-voice, renders scales and commitment cards. This is the one in the video.
2. **User research interviewer** — one agenda, five hundred participants, synthesis across all of
   them. The strongest *business* case in the list: it is a job companies pay agencies for.
3. **Onboarding concierge** — voice plus screen, walks a new customer through setup, actually
   performs steps via tools. Proves the agent can *do* and not only *ask*.
4. **Intake / triage** — structured capture with a hard schema and a refusal to guess. Proves rigor.
5. **Exit interview** — the uncomfortable one, and the most interesting. People tell an agent things
   they will not tell a person. That asymmetry is a real product insight and it deserves testing.
6. **Practice partner** — mock interview, sales roleplay, language practice. The one that shows
   voice is not just intake.

The thread connecting them: **a person talks, an artifact comes out.** If a proposed example does
not produce an artifact, it is a chatbot and it does not belong in the box.

---

## 9. What is genuinely hard here (and is not hard in OpenBot)

Worth being explicit, because these are the things that will actually consume the quarters.

- **Consent and recording.** Recording a stranger's voice is a legal surface. Two-party-consent
  jurisdictions, GDPR lawful basis, CCPA, and sector rules if anyone points this at health or
  hiring. Consent must be a first-class object with a recorded artifact, not a checkbox in a demo.
  This is the single most under-estimated item on the list.
- **Turn-taking that does not feel awful.** Barge-in, endpointing, handling silence as meaningful
  (a coach *should* wait through a pause; an IVR should not). This is where voice products live or
  die and it is mostly tuning, not architecture.
- **Cost per minute.** Realtime voice is priced per minute and a runaway session is a runaway bill
  from someone who is not your customer. Hard budget caps per engagement, per agenda, per tenant.
  Ship this in v0 — it is not a v2 feature, it is a prerequisite for a public link.
- **Abuse from the participant side.** Strangers will jailbreak it, will try to extract the system
  prompt, will feed it prompt injection, and will say things you must not store. Inverted threat
  model from OpenBot, where the operator is trusted.
- **PII arriving by voice.** The participant will say their card number out loud. Redaction has to
  happen in the transcript pipeline, before persistence, and it cannot be a post-hoc batch job.
- **Concurrency.** Thirteen coworkers versus ten thousand concurrent sessions. Different problem.
- **Trust that the outcome is honest.** If the coaching summary invents a commitment the participant
  never made, the product is worthless. The outcome layer needs evidence-binding — every claim
  traceable to a transcript span — and a review path in the console. OpenBot's `interview-notes`
  prompt is the design brief for this; make it a runtime guarantee instead of a prompt.

---

## 10. Landscape, and where we win

Directionally, as of my knowledge — **verify current state before this goes anywhere external.**

- **Voice infra** (Vapi, Retell, Bland, LiveKit Agents, Pipecat, ElevenLabs Agents). They sell
  transport and orchestration. You get audio in, audio out, a webhook. You build everything above it.
- **Closed application vendors** (Sierra, Decagon, Parloa, Intercom Fin, and in the research niche
  Outset, Listen Labs, Strella). They sell the finished outcome, per seat or per resolution, and you
  cannot change it or self-host it.
- **The model layer** (OpenAI Realtime, Gemini Live). Commoditizing the hard part, fast, which is an
  argument for building above it rather than on it.

The hole is the middle: **an open, ownable, framework-neutral kit for agent-led engagements, with UI.**
Three things we have that none of them do:

1. **Generative UI over voice.** §4. Nobody has this. It is not a feature, it is the category.
2. **Framework neutrality via AG-UI.** Bring your own agent, on any stack. The infra players make
   you write in their orchestration; the app players make you write nothing.
3. **Own it.** OpenBot's whole pitch, and it works. MIT, self-hostable, clone-and-change. For voice
   recordings of your customers, "runs in your VPC" is a stronger argument than it is for chat.

The realistic threat is not that someone else builds this. It is that the infra players move **up**
into agendas and outcomes faster than we move **down** into media. Which is another vote for §6(c):
don't race them on transport.

---

## 11. Staging

**v0 — prove the one claim (target: 4–6 weeks, demo-grade).**
One agenda, one surface, voice-to-voice on an off-the-shelf media stack, one component rendered
mid-conversation, one typed outcome written to a file. No console, no auth, no multi-tenant.
The only question v0 answers: *does voice-plus-generative-UI feel like magic or like a gimmick?*
Everything else is downstream of that answer. If it is a gimmick, stop, and the realtime work still
lands usefully in `packages/voice`.

**v0.5 — the shape.** Agenda as YAML, outcome schemas, invite links, consent capture, budget caps,
the console's read-only half (transcripts and outcomes). This is the first thing you could show
someone outside the building.

**v1 — the repo.** Four to six example engagements, the operator console with authoring, phone as a
second surface, multi-session memory via Intelligence, deploy story, docs, `prompt.txt`. The OpenBot
launch playbook, aimed at the same audience.

**Ongoing — extract upward.** As the realtime primitives stabilize, land them in CopilotKit as
`@copilotkit/realtime`, so in-app copilots get voice too and the two repos share a spine. Agentic
Kit stays the template; CopilotKit keeps the packages. That also resolves §14's focus objection:
the work is not a fork, it is a forcing function for a capability CopilotKit needs anyway.

---

## 12. Business model sketch

Worth thinking about now because it shapes the architecture.

The free thing is the repo. The paid thing is almost certainly **the console plus Intelligence**:
outcome storage, cross-engagement synthesis (five hundred interviews into themes), memory across
sessions, analytics, and the compliance surface — consent records, retention policy, redaction
audit. Those are exactly the things a company will not want to self-host on day one and exactly the
things that get more valuable with volume.

Note the shape: engagement volume is a natural metering unit in a way that copilot usage is not.
That is a better business than CopilotKit's, and it is worth weighting in the decision.

---

## 13. Naming

Taking the assignment seriously rather than rubber-stamping it.

**In favor of "Agentic Kit":** obvious sibling to CopilotKit, the org's naming already reads as a
family, and "Kit" correctly signals buildable-parts rather than product.

**Against:** "agentic" is the most exhausted word in the space and says nothing about what is
different — every product in the market claims it, so the name inherits no meaning. It is also one
letter-group away from CopilotKit in a way that will cost you in search and in conversation ("wait,
which kit?"). And it describes the *technology*, while the interesting thing is the *relationship*.

Names that describe the relationship instead: **ConciergeKit**, **SessionKit**, **EngageKit**,
**FrontDesk**, **Interlocutor**. My favorite is something in the "front of house" direction —
**OpenDesk** would sit beside OpenBot as a family, and "the desk" carries exactly the right
meaning: the place a stranger arrives and is received.

Not a hill to die on, and you have context I do not. But the name is cheap now and expensive later,
so it is worth thirty minutes before the repo is created.

---

## 14. The case against (argued honestly)

1. **Focus.** CopilotKit + AG-UI + Intelligence + OpenBot is already four surfaces, four READMEs,
   four CI systems, four support queues. A fifth is not free, and the team is not four times bigger.
   *Counter:* OpenBot proved a second repo can compound rather than dilute — but it proved it once,
   with a team that had bandwidth then.
2. **"This is just a channel."** A defensible reading: `@copilotkit/channels-voice` plus a template
   in `examples/`, and no new brand. *Counter:* channels adapt an agent to a surface. This changes
   who drives the conversation and what "done" means. That is a different kit, not a new adapter.
   But if the v0 in §11 ends up feeling like a channel, believe it and collapse it back.
3. **Commoditization.** The model providers are eating realtime voice quickly. *Counter:* correct,
   and exactly why the moat is the agenda/outcome/UI layer. If we build transport, this objection
   wins.
4. **Regulatory drag.** Recording strangers is a heavier compliance surface than anything either
   existing repo carries, and it will slow the team down in ways that are hard to feel in advance.
5. **The demo-to-production gap is brutal in voice.** A voice demo is easy and a voice product that
   does not make people hang up is very hard. Ninety percent of the work is in turn-taking polish
   that no architecture diagram shows.

I think the idea is right and the sequencing in §11 is the risk control: v0 is small enough that a
"no" is cheap, and its output is useful to CopilotKit either way.

---

## 15. Open questions — these are yours, not mine

1. **Separate repo, or a folder in CopilotKit?** I lean separate, on the strength of the OpenBot
   precedent and the different trust model — but it is close, and §14.2 is a real argument.
2. **Template or library?** OpenBot is clone-and-own with nothing published. CopilotKit is npm
   packages. Agentic Kit could be either, and it changes everything about the repo. My lean: template
   first (faster, proven motion), extract packages later per §11.
3. **Voice-first or voice-also?** Is a text-only engagement a first-class citizen? I think yes — the
   agenda/outcome structure is valuable without voice, and text is where you will debug — but if
   voice is the whole wedge, saying so sharpens the product.
4. **Phone in v1, or web only?** Telephony is a large, separate surface and a large, separate
   compliance surface. It is also what half the buyers will ask for first.
5. **Who is the buyer?** The coaching example points at product/HR/research. The support example
   points at CX. They are different companies with different budgets, and the examples we ship
   decide which one shows up. I would pick one for v1 rather than hedging.
6. **Does this share Intelligence, or need its own?** Engagement outcomes are a different data shape
   than threads. Probably reuse, but worth checking before assuming.

---

## Appendix: verified facts this document relies on

Stated separately so the analysis can be checked rather than trusted.

- `packages/voice/src/index.ts` exports only `TranscriptionServiceOpenAI`.
- `TranscriptionService` (`packages/runtime/src/v2/runtime/transcription-service/`) defines one
  method, `transcribeFile(options): Promise<string>`.
- Audio capture lives in `packages/react-core/src/v2/components/chat/CopilotChatAudioRecorder.tsx`
  and `packages/react-ui/src/hooks/use-push-to-talk.tsx` — `getUserMedia` + `MediaRecorder`,
  push-to-talk, transcript inserted as input text.
- No WebRTC, `RTCPeerConnection`, or TTS anywhere under `packages/`.
- Channel adapters exist for Slack, Teams, Discord, WhatsApp, and Telegram.
- OpenBot is explicitly "a template, not a product": MIT, nothing published, `examples/fintech/` is
  the tenant package you replace, coworkers are YAML.
- OpenBot's `interview-notes` coworker encodes the evidence discipline referenced in §3 and §9.

Competitive claims in §10 are from training knowledge and are **not** verified against the current
market. Check before reuse.
