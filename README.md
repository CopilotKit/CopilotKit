<div align=center>

<img width="120" height="120" alt="FavIcon" src="https://github.com/user-attachments/assets/779de607-2b8d-4751-872b-1243e97c7d18" />

# CopilotKit

<div align=center>

[Docs](https://docs.copilotkit.ai/?ref=github_readme) ·
[Examples](https://www.copilotkit.ai/examples) ·
[CopilotKit Intelligence](https://go.copilotkit.ai/enterprise-intelligence-platform) ·
[Discord](https://discord.gg/6dffbvGU3D?ref=github_readme)

</div>

Build **agent-native applications** — on any framework, on any surface.

Generative UI, shared state, and human-in-the-loop workflows for React, Angular, Vue, React Native — and in Slack and Microsoft Teams.

</div>

[![Bring Your Own Agent. Any Channel. — CopilotKit and AG-UI connect any agent framework to Slack, Microsoft Teams, Discord, WhatsApp, Telegram, Google Chat, iMessage, and SMS.](assets/bring-your-own-agent-any-channel.png)](https://go.copilotkit.ai/copilotkit-docs)

<div align="center" style="display:flex;justify-content:start;gap:16px;height:20px;margin: 0;">
  <a href="https://www.npmjs.com/package/@copilotkit/react-core" target="_blank">
    <img src="https://img.shields.io/npm/v/%40copilotkit%2Freact-core?logo=npm&logoColor=%23FFFFFF&label=Version&color=%236963ff" alt="NPM">
  </a>

  <a href="https://github.com/copilotkit/copilotkit/blob/main/LICENSE" target="_blank">
    <img src="assets/license-badge.svg" alt="License: MIT" height="20">
  </a>

  <a href="https://discord.gg/6dffbvGU3D" target="_blank">
    <img src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=%23FFFFFF&label=Discord&color=%236963ff" alt="Discord">
  </a>
  </div>
  <br/>
  <div>
    <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
  </a>

<div />
  <div align="center">
      <a href="https://trendshift.io/repositories/5730" target="_blank"><img src="https://trendshift.io/api/badge/repositories/5730" alt="CopilotKit%2FCopilotKit | Trendshift"                         style="width: 250px; height: 55px;" width="250" height="55"/>
    </a>
    <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
      <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=428778&theme=light&period=daily">
    </a>

  </div>

---

## What is CopilotKit?

CopilotKit is a best-in-class SDK for building full-stack agentic applications, Generative UI, and chat applications.

What started as a React library is now the **horizontal layer between your agents and your users**: the same agent can power your web app, your mobile app, and your team's Slack or Microsoft Teams workspace.

We are the company behind the **[AG-UI Protocol](https://github.com/ag-ui-protocol/ag-ui)** — adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI, and more!

## Quick Start

Up and running in under five minutes. All you need is an LLM key (OpenAI, Anthropic, Gemini, etc.).

```bash
npx copilotkit@latest create
```

## Agent Skills

CopilotKit ships [agent skills](https://docs.copilotkit.ai) that teach your coding agent (Claude Code, Codex, Cursor, Gemini, and others) how to set up, build with, integrate, debug, and upgrade CopilotKit.

Install them into any project directory:

```bash
npx copilotkit@latest skills install
```

Run it again any time to refresh to the latest skills.

## Bring Your App to Life

https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3

<div align="center"> Add AI to your app in 1 minute</div>

**Features:**

- **Chat UI** – A fully customizable chat interface that supports message streaming, tool calls, and agent responses.
- **Backend Tool Rendering** – Enables agents to call backend tools that return UI components rendered directly in the client.
- **Generative UI** – Allows agents to generate and update UI components dynamically at runtime based on user intent and agent state.
- **Shared State** – A synchronized state layer that both agents and UI components can read from and write to in real time.
- **Human-in-the-Loop** – Lets agents pause execution to request user input, confirmation, or edits before continuing.
- **Self-Learning** _(early access)_ – Agents that continuously improve from user feedback via in-context reinforcement learning (CLHF).

## 🧩 Works With Your Stack

One agent backend. Every frontend.

| Platform                                                        | Status         | Get Started                                                                                             |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| ⚛️ React / Next.js                                              | ✅ GA          | [Quickstart](https://docs.copilotkit.ai/built-in-agent/quickstart)                                      |
| 🅰️ Angular                                                      | ✅ Supported   | [Source Code & Quickstart](https://github.com/CopilotKit/CopilotKit/tree/main/packages/angular)         |
| 💚 Vue                                                          | ✅ Supported   | [Source Code - Quickstart coming soon](https://github.com/CopilotKit/CopilotKit/tree/main/packages/vue) |
| 📱 React Native                                                 | ✅ Supported   | [Quickstart](https://docs.copilotkit.ai/react-native)                                                   |
| 💬 Slack / Microsoft Teams                                      | ✅ Supported   | [Channels](https://www.copilotkit.ai/channels) · [Quickstart](https://docs.copilotkit.ai/slack)         |
| 🔜 Discord / WhatsApp / Telegram / Google Chat / iMessage / SMS | 🟡 Coming soon | [Channels](https://www.copilotkit.ai/channels)                                                          |

Your agent logic stays the same — AG-UI handles the wire protocol, CopilotKit handles the UI layer for each framework and channel.

## 💬 Channels: One Agent, Every Chat App

<img width="1920" height="1080" alt="Write it once, run every channel" src="https://github.com/user-attachments/assets/883e5ede-0387-4ae8-a361-48da3adf8f22" />

The **Channels SDK** takes the agent you already built and drops it into the chat apps your users live in — same tools, same shared state, same human-in-the-loop, no rewrite (**[Learn more](https://www.copilotkit.ai/channels)**).

- **Slack** – Agents as first-class Slack apps: threads, tool calls, and human-in-the-loop approvals right in the channel.
- **Microsoft Teams** – Bring agentic workflows to the enterprise, where your org already lives.

👉 **[Explore Channels →](https://www.copilotkit.ai/channels)**

## 🧠 Self-Learning Agents

Improve your product by learning over time.

With **Continuous Learning from Human Feedback (CLHF)**, part of [CopilotKit Intelligence](https://www.copilotkit.ai/copilotkit-intelligence), agents improve with every interaction:

- **In-context reinforcement learning** – Agents automatically improve from user interactions, no model fine-tuning required.
- **Automatic prompt augmentation** – Agent behavior adapts based on recent interactions and outcomes.
- **Per-user adaptation** – Agents learn individual preferences and get better for each user over time.
- **Threads & persistence** – Full interaction history — generative UI, human-in-the-loop, shared state — captured across sessions.

Available via CopilotKit Cloud or self-hosted.

🔒 **Early access:** We're onboarding teams now.

👉 **[Request early access →](https://go.copilotkit.ai/beyond-the-web-form)**

https://github.com/user-attachments/assets/7372b27b-8def-40fb-a11d-1f6585f556ad

What this gives you:

- **CopilotKit installed** – Core packages are fully set up in your app
- **Provider configured** – Context, state, and hooks ready to use
- **Agent <> UI connected** – Agents can stream actions and render UI immediately
- **Deployment-ready** – Your app is ready to deploy

[Complete getting started guide →](https://docs.copilotkit.ai/langgraph/quickstart)

## How it works:

CopilotKit connects your UI, agents, and tools into a single interaction loop.

![CopilotKit Diagram — Motion x2 6 sec version](https://github.com/user-attachments/assets/6f175d86-bd22-4c26-a13a-6013654ed542)

This enables:

- Agents that ask users for input
- Tools that render UI
- Stateful workflows across steps and sessions
- One agent, deployed across web, mobile, and chat platforms

## ⭐️ useAgent Hook

The `useAgent` hook sits directly on AG-UI, giving you full programmatic control over the agent connection.

```ts
// Programmatically access and control your agents
const { agent } = useAgent({ agentId: "my_agent" });

// Render and update your agent's state
return <div>
  <h1>{agent.state.city}</h1>
  <button onClick={() => agent.setState({ city: "NYC" })}>
    Set City
  </button>
</div>
```

Check out the [useAgent docs](https://go.copilotkit.ai/useagent-docs) to learn more.

https://github.com/user-attachments/assets/67928406-8abc-49a1-a851-98018b52174f

## Generative UI

Generative UI is a core CopilotKit pattern that allows agents to dynamically render UI as part of their workflow.

https://github.com/user-attachments/assets/3cfacac0-4ffd-457a-96f9-d7951e4ab7b6

### Compare the Three Types

<img width="708" height="311" alt="image" src="https://github.com/user-attachments/assets/962f49c2-31ea-43c5-b2a3-7cdde114705a" />

#### Explore:

- [Static (AG-UI Protocol)](https://docs.copilotkit.ai/ag-ui-protocol)
- [Declarative (A2UI)](https://docs.copilotkit.ai/generative-ui/specs/a2ui#using-a2ui-with-copilotkit)
- [Open-Ended (MCP Apps & Open JSON)](https://docs.copilotkit.ai/generative-ui/specs/mcp-apps)

[Generative UI educational repo →](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/generative-ui)

## 🖥️ AG-UI: The Agent–User Interaction Protocol

Connect agent workflows to user-facing apps, with deep partnerships and 1st-party integrations across the agentic stack—including LangChain, CrewAI, Mastra, PydanticAI, and more.

[![AG-UI](https://github.com/user-attachments/assets/a625237a-cfc1-45fc-8d0c-637316b81291)](https://go.copilotkit.ai/ag-ui)

---

```
npx create-ag-ui-app my-agent-app
```

  <a href="https://github.com/ag-ui-protocol/ag-ui" target="_blank">
   Learn more in the AG-UI README →
  </a>

## 🤝 Community

- [What's New](https://docs.copilotkit.ai/whats-new)
<h3>Have questions or need help?</h3>
  <a href="https://discord.gg/6dffbvGU3D?ref=github_readme" target="_blank">
   Join our Discord →
  </a> </br>
    <a href="https://docs.copilotkit.ai/?ref=github_readme" target="_blank">
  Read the Docs →
  </a> </br>
    <a href="https://dashboard.operations.copilotkit.ai?ref=github_readme" target="_blank">
   Try CopilotKit Intelligence →
  </a>
<h3>Stay up to date with our latest releases!</h3>
  <a href="https://www.linkedin.com/company/copilotkit/" target="_blank">
   Follow us on LinkedIn →
  </a> </br>
    <a href="https://x.com/copilotkit" target="_blank">
   Follow us on X →
  </a>

## 🙋🏽‍♂️ Contributing

Thanks for your interest in contributing to CopilotKit! 💜

We value all contributions, whether it's through code, documentation, creating demo apps, or just spreading the word.

Here are a few useful resources to help you get started:

- For code contributions, [CONTRIBUTING.md](./CONTRIBUTING.md).
- For documentation-related contributions, [check out the documentation contributions guide](https://docs.copilotkit.ai/contributing/docs-contributions?ref=github_readme).

- Want to contribute but not sure how? [Join our Discord](https://discord.gg/6dffbvGU3D) and we'll help you out!

## 📄 License

This repository's source code is available under the [MIT License](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE).


## 🌐 Web Resources & Interactive Index
- [BOXING GANG STARS](https://esskillcrafts.pages.dev/boxing-gang-stars.html)
- [TERMS](https://quizverses.github.io/terms.html)
- [BATTLE OF TANK STEEL](https://studyquests.github.io/battle-of-tank-steel.html)
- [SOCCER DUEL](https://quizverses-9d2f2.web.app/soccer-duel.html)
- [CATEGORY AVOID295](https://quizverses.pages.dev/category-avoid295.html)
- [CATEGORY UNBLOCKED GAMES](https://quizverses.pages.dev/category-unblocked-games.html)
- [CATEGORY MINIGAMES29](https://quizverses.pages.dev/category-minigames29.html)
- [CATEGORY MINING75](https://studyquests.github.io/category-mining75.html)
- [SKY MAZE CHALLENGE](https://quizverses.pages.dev/sky-maze-challenge.html)
- [BESTIES CHINESE NEW YEAR CELEBRATION](https://iskillquest.pages.dev/besties-chinese-new-year-celebration.html)
- [CATEGORY RACING DRIVING 2](https://quizverses.pages.dev/category-racing-driving-2.html)
- [MAHJONG 3D MATCH](https://thelearnquesters.pages.dev/mahjong-3d-match.html)
- [OLE BUNNY](https://thelearnquesters.pages.dev/ole-bunny.html)
- [FREECELL](https://thelearnquester.web.app/freecell.html)
- [ROPE SORTING](https://studyquests.github.io/rope-sorting.html)
- [INDEX14](https://studyquesthub.web.app/index14.html)
- [THATS MY SEAT](https://thequizzone.pages.dev/thats-my-seat.html)
- [OBSTACLE CAR DRIVING](https://learnquesters.pages.dev/obstacle-car-driving.html)
- [CAR STUNT RACING 3D](https://studyquests.github.io/car-stunt-racing-3d.html)
- [SPRUNKI](https://thelearnquesters.pages.dev/sprunki.html)
- [CATEGORY CRAFTING45](https://studyquesthub.web.app/category-crafting45.html)
- [LUCKY BRAINROT BLOCKS ONLINE](https://learnquester.github.io/lucky-brainrot-blocks-online.html)
- [STICKMAN PRISON ESCAPE](https://studyplayings.pages.dev/stickman-prison-escape.html)
- [WATERMELON MERGE](https://studyplayings.web.app/watermelon-merge.html)
- [WARPING BAT](https://iskillquest.pages.dev/warping-bat.html)
- [OBBY CLIMB RACING](https://studyplayings.web.app/obby-climb-racing.html)
- [FEED ME MONSTERS IDLE BATTLE](https://thelearnquester.web.app/feed-me-monsters-idle-battle.html)
- [INDEX16](https://iskillquest.pages.dev/index16.html)
- [DEADLY PARKOUR](https://learnquester.pages.dev/deadly-parkour.html)
- [CAR FIGHTER](https://quizverses.pages.dev/car-fighter.html)
- [LABUBU COLORING ADVENTURE](https://quizverses.github.io/labubu-coloring-adventure.html)
- [GOTHIC KNIFE](https://studyplayings.web.app/gothic-knife.html)
- [CARNAGE BATTLE ARENA](https://studyplayings.web.app/carnage-battle-arena.html)
- [INDEX11](https://learnquesters.pages.dev/index11.html)
- [EPIC STUNTS PVP 3D](https://studyplayings.web.app/epic-stunts-pvp-3d.html)
- [CATEGORY TOOLS](https://studyplayings.pages.dev/category-tools.html)
- [CLEAN THE OCEAN](https://iskillquest.pages.dev/clean-the-ocean.html)
- [MY LITTLE CITY](https://thelearnquester.web.app/my-little-city.html)
- [CATEGORY CLASSIC97](https://thequizzone.pages.dev/category-classic97.html)
- [COOKING CAFE FOOD CHEF](https://studyplayings.web.app/cooking-cafe-food-chef.html)
- [PAINT POP 3D](https://theskillquest.pages.dev/paint-pop-3d.html)
- [CUBE CONNECT](https://studyplayings.web.app/cube-connect.html)
- [STEALTH MASTER SNEAK CAT](https://theskillquest.pages.dev/stealth-master-sneak-cat.html)
- [CATEGORY IO](https://thelearnquester.web.app/category-io.html)
- [PRINCESS VALENTINES CRUSH](https://theskillquest.pages.dev/princess-valentines-crush.html)
- [ASMR BEAUTY JAPANESE SPA](https://theskillquest.pages.dev/asmr-beauty-japanese-spa.html)
- [CATEGORY RUNNING107](https://thequizzone.pages.dev/category-running107.html)
- [LOAD THE DISHES ASMR](https://quizverses.github.io/load-the-dishes-asmr.html)
- [MONSTER DASH](https://studyplayings.web.app/monster-dash.html)
- [CUBES 2048IO](https://learnquesters.pages.dev/cubes-2048io.html)
- [SINGLE STROKE LINE DRAW](https://learnquesters.pages.dev/single-stroke-line-draw.html)
- [CATEGORY CASUAL971](https://quizverses.github.io/category-casual971.html)
- [CATEGORY TOP DOWN251](https://thequizzone.pages.dev/category-top-down251.html)
- [CATEGORY BASKETBALL 2](https://thelearnquester.web.app/category-basketball-2.html)
- [ARCHERY MASTER BOW AND ARROW](https://studyplayings.web.app/archery-master-bow-and-arrow.html)
- [SCARY BANBAN ESCAPE](https://studyplayings.web.app/scary-banban-escape.html)
- [CATEGORY FIGHTING124](https://studyplayings.pages.dev/category-fighting124.html)
- [CAT MATCH 3](https://iskillquest.pages.dev/cat-match-3.html)
- [COOKING RESTAURANT KITCHEN](https://studyquests.github.io/cooking-restaurant-kitchen.html)
- [EPIC RACING DESCENT ON CARS](https://theskillquest.pages.dev/epic-racing-descent-on-cars.html)
- [SUPER SLIME BLACK HOLE](https://thelearnquesters.pages.dev/super-slime-black-hole.html)
- [NINE CARDS OF WINTER](https://theskillquest.pages.dev/nine-cards-of-winter.html)
- [STICKMAN HALLOWEEN SURVIVE](https://studyplayings.web.app/stickman-halloween-survive.html)
- [ANIMAL TRANSFORM RACE](https://iskillquest.pages.dev/animal-transform-race.html)
- [HALLOWEEN CHALLENGE](https://studyplayings.web.app/halloween-challenge.html)
- [HERO STORY MONSTERS CROSSING](https://studyplayings.web.app/hero-story-monsters-crossing.html)
- [CATEGORY RAMMERHEAD](https://thequizzone.pages.dev/category-rammerhead.html)
- [FASHION FAMOUS](https://studyquests.github.io/fashion-famous.html)
- [MOTO X3M DEAD AHEAD](https://studyplayings.web.app/moto-x3m-dead-ahead.html)
- [SHOP SORTING XMAS](https://theskillquest.pages.dev/shop-sorting-xmas.html)
- [BRAINROT MERGE DROP PUZZLES](https://studyquests.github.io/brainrot-merge-drop-puzzles.html)
- [INDEX32](https://quizverses.github.io/index32.html)
- [FASHIONISTA AVATAR STUDIO DRESS UP](https://theskillquest.pages.dev/fashionista-avatar-studio-dress-up.html)
- [CATEGORY BLOCK91](https://quizverses.github.io/category-block91.html)
- [CATEGORY RACING DRIVING](https://quizverses.pages.dev/category-racing-driving.html)
- [CATEGORY FLASH](https://learnquesters.pages.dev/category-flash.html)
- [BUTTERFLY KYODAI DELUXE 2](https://iskillquest.pages.dev/butterfly-kyodai-deluxe-2.html)
- [ACE CAR RACING](https://studyplayings.web.app/ace-car-racing.html)
- [SCREW IT OUT JAM MATCHING COLORED SCREWS](https://studyquests.github.io/screw-it-out-jam-matching-colored-screws.html)
- [STICKMAN PRISON AND LOVE](https://thequizzone.pages.dev/stickman-prison-and-love.html)
- [HELICOPTER BATTLE STEVE 2 PLAYER](https://studyplayings.web.app/helicopter-battle-steve-2-player.html)
- [OFFICE SPIDER SOLITAIRE](https://studyplayings.pages.dev/office-spider-solitaire.html)
- [PRINCESS ROYAL WEDDING](https://iskillquest.pages.dev/princess-royal-wedding.html)
- [CATEGORY FPS 2](https://studyquesthub.web.app/category-fps-2.html)
- [RAGDOLL BOB PUZZLE](https://studyplayings.pages.dev/ragdoll-bob-puzzle.html)
- [PONGOAL](https://thequizzone.pages.dev/pongoal.html)
- [CATEGORY PUZZLE 4](https://quizverses.pages.dev/category-puzzle-4.html)
- [CARS MERGE](https://learnquester.pages.dev/cars-merge.html)
- [DOWNHILL CAR RIDE CRASH TEST](https://themindzone.pages.dev/downhill-car-ride-crash-test.html)
- [NOOB IN GEOMETRY DASH](https://thelearnquester.web.app/noob-in-geometry-dash.html)
- [CATEGORY GOGUARDIANBYPASS](https://studyquests.github.io/category-goguardianbypass.html)
- [CATEGORY MANAGEMENT](https://quizverses.pages.dev/category-management.html)
- [FREDDYS NIGHTMARES RETURN HORROR NEW YEAR](https://themindzone.pages.dev/freddys-nightmares-return-horror-new-year.html)
- [CATEGORY INTERSTELLAR](https://thequizzone.pages.dev/category-interstellar.html)
- [CATEGORY FIGHTING124](https://learnquester.github.io/category-fighting124.html)
- [FIND THE DIFFERENCES CARS](https://thelearnquesters.pages.dev/find-the-differences-cars.html)
- [DREAM WEDDING PLANNER](https://thelearnquester.web.app/dream-wedding-planner.html)
- [CATEGORY 2D1 070](https://studyplayings.pages.dev/category-2d1-070.html)
- [CATEGORY SPACE](https://thelearnquester.web.app/category-space.html)
- [KITTY SQUAD WINTER DRESS UP](https://learnquester.pages.dev/kitty-squad-winter-dress-up.html)
- [MERGE RUN BATTLE](https://studyplayings.pages.dev/merge-run-battle.html)
- [DESERT ROVER SURVIVAL](https://learnquester.pages.dev/desert-rover-survival.html)
- [GHOST ESCAPE 3D](https://studyplayings.web.app/ghost-escape-3d.html)
- [CATEGORY COLLECT565](https://quizverses.github.io/category-collect565.html)
- [BRAINROT CLEANING](https://studyplayings.pages.dev/brainrot-cleaning.html)
- [CATEGORY SOCCER 2](https://thequizzone.pages.dev/category-soccer-2.html)
- [BARRY PRISON CHRISTMAS ADVENTURE](https://studyplayings.web.app/barry-prison-christmas-adventure.html)
- [CATEGORY IO](https://quizverses.pages.dev/category-io.html)
- [CATEGORY ANIMAL216](https://studyquesthub.web.app/category-animal216.html)
- [GOMU GOMAN](https://theskillquest.pages.dev/gomu-goman.html)
- [SKIBIDI SURVIVOR RUSH](https://studyquests.github.io/skibidi-survivor-rush.html)
- [FUN IQ PUZZLE](https://studyplayings.web.app/fun-iq-puzzle.html)
- [CATEGORY PUZZLE 11](https://thequizzone.pages.dev/category-puzzle-11.html)
- [CATEGORY SIMULATION 2](https://quizverses.github.io/category-simulation-2.html)
- [FOREST SURVIVOR ROUGELIKE](https://thelearnquesters.pages.dev/forest-survivor-rougelike.html)
- [OMEGA LAYERS](https://thelearnquesters.pages.dev/omega-layers.html)
- [POLYGON SPACE](https://studyquests.github.io/polygon-space.html)
- [COLLEGE GIRL COLORING DRESS UP](https://studyplayings.pages.dev/college-girl-coloring-dress-up.html)
- [CATEGORY PUZZLE 10](https://theskillquest.pages.dev/category-puzzle-10.html)
- [CATEGORY STRATEGY](https://learnquesters.pages.dev/category-strategy.html)
- [CATEGORY BRAIN261](https://themindzone.pages.dev/category-brain261.html)
- [CRAZY PLANE LANDING](https://thequizzone.pages.dev/crazy-plane-landing.html)
- [ASMR NAIL TREATMENT](https://learnquester.pages.dev/asmr-nail-treatment.html)
- [NUTS BOLTS SORT COLOR PUZZLE](https://thequizzone.pages.dev/nuts-bolts-sort-color-puzzle.html)
- [BLOCKIBO COLOR BLOCKS](https://studyplayings.pages.dev/blockibo-color-blocks.html)
- [RED ESCAPE](https://studyplayings.web.app/red-escape.html)
- [CATEGORY BLOCK94](https://thequizzone.pages.dev/category-block94.html)
- [DRIVE TO SURVIVE](https://studyquests.github.io/drive-to-survive.html)
- [DEFORM IT](https://learnquester.github.io/deform-it.html)
- [TANK SNIPER 3D](https://studyplayings.pages.dev/tank-sniper-3d.html)
