export interface ShowcaseMessage {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
}
