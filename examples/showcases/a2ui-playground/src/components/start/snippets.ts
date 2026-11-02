/**
 * The code in the Get started prompt. The snippets type-check against the
 * installed @copilotkit/* 1.83.0 typings.
 */

export const INSTALL =
  "npm i @copilotkit/react-core@1.83.0 @copilotkit/runtime@1.83.0 zod@3.25.76";

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

export const EXPORT_CATALOG = `import { exportA2UICatalog } from "@copilotkit/react-core/v2/generative-ui";
import { ui } from "./genui";

const catalog = exportA2UICatalog(ui, {
  title: "Acme",
  description: "Acme's app components",
});
// { catalogId, components: { WeatherCard: <JSON Schema>, ... }, functions, $defs }`;
