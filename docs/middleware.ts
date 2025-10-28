import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Common redirects for broken links
  const redirects: Record<string, string> = {
    // Old coagents paths
    '/coagents': '/langgraph',
    '/coagents/quickstart': '/langgraph/quickstart',
    '/coagents/guides': '/langgraph/guides',
    '/coagents/shared-state': '/langgraph/shared-state',
    '/coagents/human-in-the-loop': '/langgraph/human-in-the-loop',
    '/coagents/multi-agent-flows': '/langgraph/multi-agent-flows',
    '/coagents/persistence': '/langgraph/persistence',
    '/coagents/advanced': '/langgraph/advanced',
    '/coagents/videos': '/langgraph/videos',
    '/coagents/tutorials': '/langgraph/tutorials',
    '/coagents/concepts': '/langgraph/concepts',
    '/coagents/frontend-actions': '/langgraph/frontend-actions',
    '/coagents/generative-ui': '/langgraph/generative-ui',
    
    // Common typos and variations
    '/direct-to-llm/guide': '/direct-to-llm/guides',
    '/langgraph/guide': '/langgraph/guides',
    '/mastra/guide': '/mastra/guides',
    '/agno/guide': '/agno/guides',
    '/llamaindex/guide': '/llamaindex/guides',
    '/crewai-crews/guide': '/crewai-crews/guides',
    '/crewai-flows/guide': '/crewai-flows/guides',
    '/ag2/guide': '/ag2/guides',
    '/pydantic-ai/guide': '/pydantic-ai/guides',
    '/adk/guide': '/adk/guides',
    
    // API reference variations
    '/api': '/reference',
    '/docs/api': '/reference',
    '/api-reference': '/reference',
    
    // Quickstart variations
    '/quickstart': '/direct-to-llm/guides/quickstart',
    '/getting-started': '/direct-to-llm/guides/quickstart',
    '/start': '/direct-to-llm/guides/quickstart',
    
    // Frontend tools variations
    '/frontend-tools': '/direct-to-llm/guides/frontend-actions',
    '/frontend-actions': '/direct-to-llm/guides/frontend-actions',
    
    // Contributing paths
    '/contributing/code-contributions/package-linking': '/shared/contributing/code-contributions/package-linking',
  };

  // Check for exact matches
  if (redirects[pathname]) {
    return NextResponse.redirect(new URL(redirects[pathname], request.url));
  }

  // Check for pattern-based redirects
  if (pathname.startsWith('/coagents/')) {
    const newPath = pathname.replace('/coagents/', '/langgraph/');
    return NextResponse.redirect(new URL(newPath, request.url));
  }

  // Handle guide -> guides redirects
  if (pathname.includes('/guide') && !pathname.includes('/guides')) {
    const newPath = pathname.replace('/guide', '/guides');
    return NextResponse.redirect(new URL(newPath, request.url));
  }

  // Handle quickstart redirects for specific frameworks
  if (pathname === '/quickstart') {
    return NextResponse.redirect(new URL('/direct-to-llm/guides/quickstart', request.url));
  }

  // Check for partial matches and suggest alternatives
  const suggestions = generateSuggestions(pathname);
  
  if (suggestions.length > 0) {
    // For now, we'll let the 404 page handle suggestions
    // In the future, we could redirect to a special 404 page with suggestions
  }

  return NextResponse.next();
}

function generateSuggestions(pathname: string): string[] {
  const suggestions: string[] = [];
  
  // Common patterns that might be typos
  if (pathname.includes('guide') && !pathname.includes('guides')) {
    suggestions.push(pathname.replace('guide', 'guides'));
  }
  
  if (pathname.includes('coagents')) {
    suggestions.push(pathname.replace('coagents', 'langgraph'));
  }
  
  if (pathname.includes('/api') && !pathname.includes('/reference')) {
    suggestions.push('/reference');
  }
  
  return suggestions;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
