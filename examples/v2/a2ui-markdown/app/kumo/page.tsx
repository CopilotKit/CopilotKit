"use client";

import { ExamplePage } from "../example-page";
import { kumoTheme } from "../../kumo/theme";
import { kumoUI } from "../../kumo/ui";

export default function KumoPage() {
  return <ExamplePage ui={kumoUI} theme={kumoTheme} basePath="/kumo" />;
}
