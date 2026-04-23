import { describe, test, expect } from "@jest/globals";
import { renderAlert } from "../../src/tips/renderers/alert.js";
import type { Alert } from "../../src/tips/loaders/remote.js";

describe("renderAlert", () => {
  test("renders warning alert with prefix", () => {
    const alert: Alert = { message: "Update to v2.0", level: "warning" };
    const lines: string[] = [];
    renderAlert(alert, (msg) => lines.push(msg));

    expect(lines).toHaveLength(2); // blank line + message
    expect(lines[0]).toBe("");
    expect(lines[1]).toContain("Update to v2.0");
  });

  test("renders info alert", () => {
    const alert: Alert = { message: "New feature available", level: "info" };
    const lines: string[] = [];
    renderAlert(alert, (msg) => lines.push(msg));

    expect(lines[1]).toContain("New feature available");
  });

  test("renders error alert", () => {
    const alert: Alert = { message: "Service outage", level: "error" };
    const lines: string[] = [];
    renderAlert(alert, (msg) => lines.push(msg));

    expect(lines[1]).toContain("Service outage");
  });
});
