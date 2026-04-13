export function flattenObject(
  obj: Record<string, any>,
  parentKey = "",
  res: Record<string, any> = {},
): Record<string, any> {
  for (const key in obj) {
    const propName = parentKey ? `${parentKey}.${key}` : key;
    if (typeof obj[key] === "object" && obj[key] !== null) {
      flattenObject(obj[key], propName, res);
    } else {
      res[propName] = obj[key];
    }
  }
  return res;
}
