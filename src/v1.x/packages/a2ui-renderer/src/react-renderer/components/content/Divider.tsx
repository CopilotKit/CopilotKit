import { memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject } from '../../lib/utils';

/**
 * Divider component - renders a visual separator line.
 *
 * Structure mirrors Lit's Divider component:
 *   <div class="a2ui-divider">  ← :host equivalent
 *     <hr class="...">          ← internal element
 *   </div>
 */
export const Divider = memo(function Divider({ node, surfaceId }: A2UIComponentProps<Types.DividerNode>) {
  const { theme } = useA2UIComponent(node, surfaceId);

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-divider" style={hostStyle}>
      <hr
        className={classMapToString(theme.components.Divider)}
        style={stylesToObject(theme.additionalStyles?.Divider)}
      />
    </div>
  );
});

export default Divider;
