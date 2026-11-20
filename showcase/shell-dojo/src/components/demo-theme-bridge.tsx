"use client";

import { useEffect } from "react";
import {
  darkClassSource,
  installThemeBridge,
} from "../../../integrations/_shared/ts/theme";

/**
 * Keeps embedded demos on this page's theme: answers their theme requests
 * and re-sends when the `dark` class on <html> changes. The protocol lives in
 * `showcase/integrations/_shared/ts/theme.ts`.
 */
export function DemoThemeBridge() {
  useEffect(() => installThemeBridge(window, darkClassSource(document)), []);
  return null;
}
