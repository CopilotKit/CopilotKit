/**
 * The code on /start. The TypeScript snippets type-check against the installed
 * @copilotkit/* 1.83.0 typings; the Python one is examples/adk/agent.py without
 * its docstrings.
 */

import { REPO_DIR, REPO_URL } from "./links";

export const INSTALL = "npm i @copilotkit/react-core@1.83.0 @copilotkit/runtime@1.83.0 zod@3.25.76";

export const CATALOG = `"use client";
import { createGenerativeUI, standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { z } from "zod";

const weatherProps = z.object({
  city: z.string(),
  tempC: z.number(),
  summary: z.string().optional(),
});

function WeatherCard({ city, tempC, summary }: z.infer<typeof weatherProps>) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm opacity-70">{city}</p>
      <p className="text-3xl font-semibold">{tempC}°C</p>
      {summary ? <p className="text-sm">{summary}</p> : null}
    </div>
  );
}

export const ui = createGenerativeUI({
  id: "acme/app@1",
  extends: [standardUI], // the 69 standard components: Column, Card, Text, Button...
  components: {
    WeatherCard: {
      component: WeatherCard,
      description: "Current weather for one city.",
      props: weatherProps,
    },
  },
});`;

export const PROVIDER = `"use client";
import "@copilotkit/react-core/v2/styles.css";
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { ui } from "./genui";

export default function Page() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui }}>
      <CopilotChat />
    </CopilotKitProvider>
  );
}`;

export const ROUTE = `import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const copilotRuntime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: "google/gemini-flash-latest" }) },
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});
export const GET = handler;
export const POST = handler;`;

/** Shortened from src/agent/express.ts and compose-express.ts. The Express reply compiles as written. */
export const EXPRESS = `import {
  A2uiGenerator,
  CatalogConfig,
  ExpressFormatFactory,
  InMemoryCatalogProvider,
} from "@a2ui/agent";
// The exported catalog, plus the schemas of the macros (FlightCard, ProductCard, WeatherReport).
import inference from "@/a2ui/export/inference-catalog.json";
import { macros } from "@/a2ui/macros/macros";

const generator = new A2uiGenerator([new CatalogConfig(new InMemoryCatalogProvider(inference).load())]);
const caps = { "v1.0": { supportedCatalogIds: [inference.catalogId] } };

// What Gemini writes: one line per component, no tool call.
const reply = \`<a2ui>
root = Column([head, w], _, _, _, _, 3)
head = Heading("Lisbon this week", "Live weather")
w = WeatherReport("Lisbon")
</a2ui>\`;

// The SDK compiles it against the catalog into A2UI 1.0 messages.
const processor = generator.createProcessor(caps, new ExpressFormatFactory({ surfaceId: "weather" }));
const messages = processor.parseResponse(reply).flatMap((p) => (p.type === "a2ui" ? p.a2ui : []));

// WeatherReport is a macro: the server loads the forecast and expands it into
// standard components (Card, Row, Title, Chart...) before anything reaches the browser.
const written = messages.flatMap((m) => m.createSurface?.components ?? m.updateComponents?.components ?? []);
const { components } = await macros.expand(written);`;

export const ADK_AGENT = `import os

from ag_ui_adk import CONTEXT_STATE_KEY, AGUIToolset
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext

MODEL = os.getenv("ADK_MODEL", "gemini-3.5-flash")

INSTRUCTION = """You are a helpful assistant that answers with UI.
For every request, call the render_ui tool with A2UI v1.0 operations built
only from the components in the generative UI guide below. Keep any text
reply to one short sentence."""


def instruction(ctx: ReadonlyContext) -> str:
    parts = [INSTRUCTION]
    for item in ctx.state.get(CONTEXT_STATE_KEY, []):
        parts.append(f"## {item['description']}\\n\\n{item['value']}")
    return "\\n\\n".join(parts)


root_agent = LlmAgent(
    name="a2ui_adk_agent",
    model=MODEL,
    description="Answers with generative UI built from the app's catalog.",
    instruction=instruction,
    # The tools the client sends with the run (here: the runtime's render_ui).
    tools=[AGUIToolset()],
)`;

export const ADK_SERVER = `from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from fastapi import FastAPI

from agent import root_agent

adk_agent = ADKAgent(
    adk_agent=root_agent,
    app_name="a2ui_adk",
    user_id="demo",
    # One ADK session per AG-UI thread.
    use_thread_id_as_session_id=True,
)

app = FastAPI(title="A2UI ADK agent")
add_adk_fastapi_endpoint(app, adk_agent, path="/")`;

export const ADK_ROUTE = `import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

const copilotRuntime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({ url: process.env.ADK_AGENT_URL ?? "http://localhost:8000/" }),
  },
});

const handler = createCopilotRuntimeHandler({ runtime: copilotRuntime, basePath: "/api/adk" });
export const GET = handler;
export const POST = handler;`;

/** Needs the public repo: /start hides it while REPO_URL is unset. */
export const ADK_RUN = `git clone ${REPO_URL} && cd ${REPO_DIR}
cd examples/adk
uv sync
export GOOGLE_API_KEY=your-key
uv run server.py           # AG-UI endpoint on http://localhost:8000/

# in a second terminal, from the repo root
pnpm install && pnpm dev   # open http://localhost:3100/adk`;

export const EXPORT_CATALOG = `import { exportA2UICatalog } from "@copilotkit/react-core/v2/generative-ui";
import { ui } from "./genui";

const catalog = exportA2UICatalog(ui, {
  title: "Acme",
  description: "Acme's app components",
});
// { catalogId, components: { WeatherCard: <JSON Schema>, ... }, functions, $defs }`;
