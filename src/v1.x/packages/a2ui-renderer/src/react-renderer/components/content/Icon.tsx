import { memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject } from '../../lib/utils';

/**
 * Convert camelCase to snake_case for Material Symbols font.
 * e.g., "shoppingCart" -> "shopping_cart"
 * This matches the Lit renderer's approach.
 */
function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Icon component - renders an icon using Material Symbols Outlined font.
 *
 * This matches the Lit renderer's approach using the g-icon class with
 * Material Symbols Outlined font.
 *
 * @example Add Material Symbols font to your HTML:
 * ```html
 * <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
 * ```
 */
export const Icon = memo(function Icon({ node, surfaceId }: A2UIComponentProps<Types.IconNode>) {
  const { theme, resolveString } = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const iconName = resolveString(props.name);

  if (!iconName) {
    return null;
  }

  // Convert camelCase to snake_case for Material Symbols
  const snakeCaseName = toSnakeCase(iconName);

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-icon" style={hostStyle}>
      <section
        className={classMapToString(theme.components.Icon)}
        style={stylesToObject(theme.additionalStyles?.Icon)}
      >
        <span className="g-icon">{snakeCaseName}</span>
      </section>
    </div>
  );
});

export default Icon;
