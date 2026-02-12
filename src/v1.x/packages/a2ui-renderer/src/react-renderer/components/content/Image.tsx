import { memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject, mergeClassMaps } from '../../lib/utils';

type UsageHint = 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';
type FitMode = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

/**
 * Image component - renders an image from a URL with optional sizing and fit modes.
 *
 * Supports usageHint values: icon, avatar, smallFeature, mediumFeature, largeFeature, header
 * Supports fit values: contain, cover, fill, none, scale-down (maps to object-fit via CSS variable)
 */
export const Image = memo(function Image({ node, surfaceId }: A2UIComponentProps<Types.ImageNode>) {
  const { theme, resolveString } = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const url = resolveString(props.url);
  const usageHint = props.usageHint as UsageHint | undefined;
  const fit = (props.fit as FitMode) ?? 'fill';

  // Get merged classes for section (matches Lit's Styles.merge)
  const classes = mergeClassMaps(
    theme.components.Image.all,
    usageHint ? theme.components.Image[usageHint] : {}
  );

  // Build style object with object-fit as CSS variable (matches Lit)
  const style: React.CSSProperties = {
    ...stylesToObject(theme.additionalStyles?.Image),
    '--object-fit': fit,
  } as React.CSSProperties;

  if (!url) {
    return null;
  }

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-image" style={hostStyle}>
      <section
        className={classMapToString(classes)}
        style={style}
      >
        <img src={url} alt="" />
      </section>
    </div>
  );
});

export default Image;
