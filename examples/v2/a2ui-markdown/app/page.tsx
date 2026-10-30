"use client";

import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { ExamplePage } from "./example-page";

export default function Page() {
  return <ExamplePage ui={standardUI} basePath="" />;
}
