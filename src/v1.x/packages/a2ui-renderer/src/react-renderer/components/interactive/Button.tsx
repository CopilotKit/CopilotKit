import { useCallback, memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject } from '../../lib/utils';
import { ComponentNode } from '../../core/ComponentNode';

/**
 * Button component - a clickable element that triggers an action.
 *
 * Contains a child component (usually Text or Icon) and dispatches
 * a user action when clicked.
 */
export const Button = memo(function Button({ node, surfaceId }: A2UIComponentProps<Types.ButtonNode>) {
  const { theme, sendAction } = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const handleClick = useCallback(() => {
    if (props.action) {
      sendAction(props.action);
    }
  }, [props.action, sendAction]);

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-button" style={hostStyle}>
      <button
        className={classMapToString(theme.components.Button)}
        style={stylesToObject(theme.additionalStyles?.Button)}
        onClick={handleClick}
      >
        <ComponentNode node={props.child} surfaceId={surfaceId} />
      </button>
    </div>
  );
});

export default Button;
