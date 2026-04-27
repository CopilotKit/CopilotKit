import { useMemo } from 'react';
import {
  DuplicateIcon,
  MarkdownIcon,
  ChatGPTIcon,
  ClaudeIcon,
  PerplexityIcon,
} from '../icons/ContextMenuIcons';

export type ContextualOptionItem = {
  id: string;
  title: string;
  description: string;
  icon?: React.ElementType;
  action: () => void | Promise<boolean>;
  externalLink?: boolean;
};

const AI_PROVIDER_URLS = {
  chatgpt: 'https://chat.openai.com/?hints=search&q=',
  claude: 'https://claude.ai/new?q=',
  perplexity: 'https://www.perplexity.ai/search?q=',
} as const;

function openInAIProvider(provider: keyof typeof AI_PROVIDER_URLS) {
  const url = new URL(window.location.href);
  url.hash = '';
  const prompt = `Read from ${url.toString()}.md so I can ask questions about it.`;
  window.open(
    `${AI_PROVIDER_URLS[provider]}${encodeURIComponent(prompt)}`,
    '_blank',
  );
}

export function useContextualOptions({
  pathname,
  options: configOptions,
}: {
  pathname: string;
  options?: string[];
}) {
  const markdownUrl = `${pathname}.md`;

  const allOptions: ContextualOptionItem[] = useMemo(
    () => [
      {
        id: 'copy',
        title: 'Copy page',
        description: 'Copy page as Markdown for LLMs',
        icon: DuplicateIcon,
        action: async (): Promise<boolean> => {
          try {
            const response = await fetch(markdownUrl);
            if (!response.ok) throw new Error('Failed to fetch markdown');
            await navigator.clipboard.writeText(await response.text());
            return true;
          } catch (error) {
            console.error('Failed to copy page:', error);
            return false;
          }
        },
      },
      {
        id: 'view',
        title: 'View as markdown',
        description: 'View this page as plain text',
        icon: MarkdownIcon,
        action: () => {
          window.open(markdownUrl, '_blank');
        },
        externalLink: true,
      },
      {
        id: 'chatgpt',
        title: 'Open in ChatGPT',
        description: 'Ask questions about page',
        icon: ChatGPTIcon,
        action: () => openInAIProvider('chatgpt'),
        externalLink: true,
      },
      {
        id: 'claude',
        title: 'Open in Claude',
        description: 'Ask questions about page',
        icon: ClaudeIcon,
        action: () => openInAIProvider('claude'),
        externalLink: true,
      },
      {
        id: 'perplexity',
        title: 'Open in Perplexity',
        description: 'Ask questions about page',
        icon: PerplexityIcon,
        action: () => openInAIProvider('perplexity'),
        externalLink: true,
      },
    ],
    [markdownUrl],
  );

  const options = useMemo(() => {
    if (!configOptions || configOptions.length === 0) return allOptions;

    return configOptions
      .map((optionId) => allOptions.find((o) => o.id === optionId))
      .filter((option): option is ContextualOptionItem => option !== undefined);
  }, [configOptions, allOptions]);

  return { options };
}
