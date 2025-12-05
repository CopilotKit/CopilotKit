# Broken Link Handling

This document describes the system for handling broken links in the CopilotKit documentation.

## Overview

The documentation now includes several mechanisms to provide a better user experience when links are broken:

1. **Enhanced 404 Page** - A user-friendly 404 page with suggestions
2. **Link Validation** - Components that can detect and handle broken links
3. **Automatic Redirects** - Middleware that redirects common broken link patterns
4. **Link Checking Script** - A script to detect broken links during development

## Components

### Enhanced 404 Page (`app/not-found.tsx`)

The 404 page now provides:
- Clear error messaging
- Navigation options (Go Home, Go Back)
- Suggestions for main documentation sections
- Visual icons and better styling

### Broken Link Handler (`components/react/broken-link-handler.tsx`)

Components for handling broken links:
- `BrokenLinkHandler` - Wraps links with validation
- `EnhancedNavigationLink` - Enhanced navigation link with validation

### Link Validation (`lib/link-validation.ts`)

Utilities for validating links and providing suggestions:
- `validateLink()` - Validates if a link is broken
- `generateSuggestions()` - Creates suggestions for broken links
- `createLinkSuggestion()` - Creates suggestion objects

### Middleware (`middleware.ts`)

Handles automatic redirects for common broken link patterns:
- Old coagents paths → LangGraph paths
- Common typos (guide → guides)
- API reference variations

## Usage

### Running the Link Checker

```bash
npm run check-links
```

This will:
- Scan all documentation files
- Extract internal links
- Validate each link
- Report broken links with suggestions

### Adding New Redirects

To add new redirects, update the `redirects` object in `middleware.ts`:

```typescript
const redirects: Record<string, string> = {
  '/old-path': '/new-path',
  // Add more redirects here
};
```

### Using Link Validation Components

```tsx
import { BrokenLinkHandler, EnhancedNavigationLink } from '@/components/react/broken-link-handler';

// For basic link handling
<BrokenLinkHandler href="/some-link" fallbackHref="/">
  Link Text
</BrokenLinkHandler>

// For enhanced navigation
<EnhancedNavigationLink href="/some-link">
  Link Text
</EnhancedNavigationLink>
```

## Best Practices

1. **Regular Link Checking** - Run `npm run check-links` regularly during development
2. **Update Redirects** - Add redirects for moved or renamed pages
3. **Test 404 Pages** - Manually test the 404 page experience
4. **Monitor Analytics** - Track 404 errors to identify common broken links

## Future Improvements

- [ ] Implement fuzzy matching for link suggestions
- [ ] Add search functionality to 404 page
- [ ] Create automated link validation in CI/CD
- [ ] Add analytics tracking for broken links
- [ ] Implement link health monitoring dashboard

## Troubleshooting

### Common Issues

1. **Links not redirecting** - Check middleware.ts redirects
2. **404 page not showing** - Verify not-found.tsx is in the correct location
3. **Link checker not working** - Ensure all dependencies are installed

### Debug Mode

To debug link validation, you can add console logs to the validation functions or run the link checker with verbose output.
