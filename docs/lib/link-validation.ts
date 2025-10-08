import { source } from '@/app/source';

export interface LinkSuggestion {
  href: string;
  title: string;
  description?: string;
  confidence: number;
}

export interface BrokenLinkInfo {
  originalHref: string;
  suggestions: LinkSuggestion[];
  isExternal: boolean;
}

/**
 * Validates if a link is broken and provides suggestions
 */
export function validateLink(href: string): BrokenLinkInfo {
  const isExternal = href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:');
  
  if (isExternal) {
    return {
      originalHref: href,
      suggestions: [],
      isExternal: true
    };
  }

  // For internal links, check if the page exists
  const normalizedHref = href.startsWith('/') ? href.slice(1) : href;
  const slug = normalizedHref.split('/').filter(Boolean);
  
  try {
    const page = source.getPage(slug);
    if (page) {
      return {
        originalHref: href,
        suggestions: [],
        isExternal: false
      };
    }
  } catch (error) {
    // Page doesn't exist
  }

  // Generate suggestions based on the broken link
  const suggestions = generateSuggestions(href, slug);
  
  return {
    originalHref: href,
    suggestions,
    isExternal: false
  };
}

/**
 * Generates suggestions for a broken link
 */
function generateSuggestions(originalHref: string, slug: string[]): LinkSuggestion[] {
  const suggestions: LinkSuggestion[] = [];
  
  // Get all available pages for fuzzy matching
  const allPages = getAllPages();
  
  if (slug.length === 0) {
    // If it's just a root link, suggest main sections
    suggestions.push(
      { href: '/direct-to-llm', title: 'Direct to LLM', description: 'Build copilots with any LLM', confidence: 0.8 },
      { href: '/langgraph', title: 'LangGraph', description: 'Agentic workflows and state machines', confidence: 0.8 },
      { href: '/mastra', title: 'Mastra', description: 'Multi-agent orchestration', confidence: 0.8 },
      { href: '/reference', title: 'API Reference', description: 'Complete API documentation', confidence: 0.8 }
    );
    return suggestions;
  }

  // Try to find similar pages
  const lastSegment = slug[slug.length - 1];
  const similarPages = allPages.filter(page => {
    const pageSlug = page.slugs.join('/');
    return pageSlug.includes(lastSegment) || 
           page.data.title?.toLowerCase().includes(lastSegment.toLowerCase());
  });

  similarPages.slice(0, 3).forEach(page => {
    suggestions.push({
      href: `/${page.slugs.join('/')}`,
      title: page.data.title || 'Untitled',
      description: page.data.description,
      confidence: 0.7
    });
  });

  // If no similar pages found, suggest main sections
  if (suggestions.length === 0) {
    const firstSegment = slug[0];
    if (firstSegment) {
      suggestions.push(
        { href: `/${firstSegment}`, title: `${firstSegment} Documentation`, confidence: 0.6 },
        { href: '/', title: 'Home', confidence: 0.5 }
      );
    }
  }

  return suggestions;
}

/**
 * Gets all available pages (this would need to be implemented based on your source structure)
 */
function getAllPages(): Array<{ slugs: string[]; data: { title?: string; description?: string } }> {
  // This is a simplified version - you'd need to implement this based on your source structure
  try {
    // This would need to be implemented to get all pages from your source
    return [];
  } catch (error) {
    return [];
  }
}

/**
 * Creates a link suggestion component
 */
export function createLinkSuggestion(suggestion: LinkSuggestion) {
  return {
    href: suggestion.href,
    title: suggestion.title,
    description: suggestion.description,
    confidence: suggestion.confidence
  };
}
