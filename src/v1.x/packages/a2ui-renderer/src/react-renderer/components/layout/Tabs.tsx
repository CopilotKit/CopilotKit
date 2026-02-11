import { useState, memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject, mergeClassMaps } from '../../lib/utils';
import { ComponentNode } from '../../core/ComponentNode';

/**
 * Tabs component - displays content in switchable tabs.
 */
export const Tabs = memo(function Tabs({ node, surfaceId }: A2UIComponentProps<Types.TabsNode>) {
  const { theme, resolveString } = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const [selectedIndex, setSelectedIndex] = useState(0);

  const tabItems = props.tabItems ?? [];

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-tabs" style={hostStyle}>
    <section
      className={classMapToString(theme.components.Tabs.container)}
      style={stylesToObject(theme.additionalStyles?.Tabs)}
    >
      {/* Tab buttons - uses Tabs.element for the container */}
      <div
        id="buttons"
        className={classMapToString(theme.components.Tabs.element)}
      >
        {tabItems.map((tab, index) => {
          const title = resolveString(tab.title);
          const isSelected = index === selectedIndex;

          // Lit merges all + selected classes when selected
          const classes = isSelected
            ? mergeClassMaps(
                theme.components.Tabs.controls.all,
                theme.components.Tabs.controls.selected
              )
            : theme.components.Tabs.controls.all;

          return (
            <button
              key={index}
              disabled={isSelected}
              className={classMapToString(classes)}
              onClick={() => setSelectedIndex(index)}
            >
              {title}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tabItems[selectedIndex] && (
        <ComponentNode
          node={tabItems[selectedIndex].child}
          surfaceId={surfaceId}
        />
      )}
    </section>
    </div>
  );
});

export default Tabs;
