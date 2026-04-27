export type AnchorItem = {
  name: string;
  href: string;
  icon?: string;
  color?: string;
};

export type SidebarItemStyle =
  | 'container'
  | 'card'
  | 'border'
  | 'undecorated'
  | 'arrow'
  | 'plain';
