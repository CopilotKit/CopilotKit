export type TicketMeta = {
  title: string;
  refs: string[];
  notes?: string;
};

export type TicketModule = {
  meta: TicketMeta;
  default: React.ComponentType;
};

export type ResolvedTicket = {
  meta: TicketMeta;
  Component: React.ComponentType;
  derivedPath: string;
  label: string;
};
