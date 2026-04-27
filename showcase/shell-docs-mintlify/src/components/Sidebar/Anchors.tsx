import { Anchor } from './Anchor';
import type { AnchorItem } from './types';

interface AnchorsProps {
  anchors: AnchorItem[];
}

export function Anchors({ anchors }: AnchorsProps) {
  return (
    <ul className="list-none mb-6 pl-4">
      {anchors.map((anchor) => (
        <li key={anchor.href} className="list-none">
          <Anchor
            href={anchor.href}
            name={anchor.name}
            icon={anchor.icon}
            color={anchor.color}
          />
        </li>
      ))}
    </ul>
  );
}
