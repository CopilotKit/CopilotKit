import { v4 as uuidv4, validate, v5 as uuidv5 } from "uuid";

export function randomId() {
  return "ck-" + uuidv4();
}

export function randomUUID() {
  return uuidv4();
}

/**
 * Recursively converts an object to a serializable form by converting functions to their string representation.
 */
function toSerializable(value: unknown): unknown {
  if (typeof value === "function") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(toSerializable);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = toSerializable((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function dataToUUID(input: string | object, namespace?: string): string {
  const BASE_NAMESPACE = "e4b01160-ff74-4c6e-9b27-d53cd930fe8e";
  // Since namespace needs to be a uuid, we are creating a uuid for it.
  const boundNamespace = namespace ? uuidv5(namespace, BASE_NAMESPACE) : BASE_NAMESPACE;

  const stringInput = typeof input === "string" ? input : JSON.stringify(toSerializable(input));
  return uuidv5(stringInput, boundNamespace);
}

export function isValidUUID(uuid: string) {
  return validate(uuid);
}
