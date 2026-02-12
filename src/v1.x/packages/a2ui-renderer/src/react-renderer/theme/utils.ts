/**
 * Converts a theme class map (Record<string, boolean>) to a className string.
 *
 * @param classMap - An object where keys are class names and values are booleans
 * @returns A space-separated string of class names where the value is true
 *
 * @example
 * classMapToString({ 'a2ui-button': true, 'a2ui-button--primary': true, 'disabled': false })
 * // Returns: 'a2ui-button a2ui-button--primary'
 */
export function classMapToString(classMap: Record<string, boolean> | undefined): string {
  if (!classMap) return '';
  return Object.entries(classMap)
    .filter(([, enabled]) => enabled)
    .map(([className]) => className)
    .join(' ');
}

/**
 * Converts an additional styles object (Record<string, string>) to a React style object.
 *
 * @param styles - An object with CSS property names as keys and values as strings
 * @returns A React-compatible style object, or undefined if no styles
 *
 * @example
 * stylesToObject({ 'background-color': 'red', 'font-size': '16px', '--custom-var': 'blue' })
 * // Returns: { backgroundColor: 'red', fontSize: '16px', '--custom-var': 'blue' }
 */
export function stylesToObject(
  styles: Record<string, string> | undefined
): React.CSSProperties | undefined {
  if (!styles || Object.keys(styles).length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    // Preserve CSS custom properties (--var-name) as-is
    if (key.startsWith('--')) {
      result[key] = value;
    } else {
      // Convert kebab-case to camelCase for React
      const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = value;
    }
  }
  return result as React.CSSProperties;
}
