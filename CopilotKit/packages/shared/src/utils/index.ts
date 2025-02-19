export * from "./conditions";
export * from "./errors";
export * from "./json-schema";
export * from "./random-id";

export function parseJson(json: string, fallback: any = "unset") {
  try {
    return JSON.parse(json);
  } catch (e) {
    return fallback === "unset" ? null : fallback;
  }
}
