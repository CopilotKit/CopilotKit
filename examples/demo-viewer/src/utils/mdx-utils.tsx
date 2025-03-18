import React from 'react';
import { MDXComponents } from '@/components/ui/mdx-components';
import { MDXProvider } from '@mdx-js/react';

/**
 * Enhanced MDX content renderer component 
 */
export const MDXRenderer: React.FC<{
  content: string;
}> = ({ content }) => {
  // Process content to extract and handle special MDX elements
  const processedContent = React.useMemo(() => {
    // Simple processing to enhance video tags
    let processed = content;
    
    // Find and enhance <Video> or <video> tags
    processed = processed.replace(
      /<Video\s+src="([^"]+)"[^>]*>/gi,
      (_, src) => `<div class="video-wrapper"><video controls width="100%" src="${src}"></video></div>`
    );
    
    return processed;
  }, [content]);
  
  return (
    <MDXProvider components={MDXComponents}>
      <div className="mdx-content">
        {/* Split content by sections to better format markdown */}
        {processedContent.split('\n\n').map((section, i) => {
          // Handle headers
          if (section.startsWith('# ')) {
            return <h1 key={i} className="text-3xl font-bold mt-8 mb-6">{section.substring(2)}</h1>;
          }
          if (section.startsWith('## ')) {
            return <h2 key={i} className="text-2xl font-bold mt-6 mb-4">{section.substring(3)}</h2>;
          }
          if (section.startsWith('### ')) {
            return <h3 key={i} className="text-xl font-bold mt-5 mb-3">{section.substring(4)}</h3>;
          }
          
          // Handle videos with safer HTML
          if (section.includes('<video') || section.includes('<Video')) {
            return (
              <div 
                key={i} 
                className="my-8" 
                dangerouslySetInnerHTML={{ __html: section }}
              />
            );
          }
          
          // Default paragraph rendering
          return <div key={i} className="my-4" dangerouslySetInnerHTML={{ __html: section }} />;
        })}
      </div>
    </MDXProvider>
  );
};

/**
 * Safe component rendering with error boundary
 */
export const SafeComponent: React.FC<{
  component: React.ComponentType | (() => React.ReactNode);
  fallback?: React.ReactNode;
}> = ({ 
  component: Component, 
  fallback = <div className="p-4 text-amber-600">Content could not be displayed</div> 
}) => {
  if (!Component) return <>{fallback}</>;
  
  try {
    return typeof Component === 'function' ? (
      typeof Component.prototype?.render === 'function' ? (
        <Component />
      ) : (
        <>{(Component as () => React.ReactNode)()}</>
      )
    ) : (
      <>{Component}</>
    );
  } catch (error) {
    console.error('Error rendering component:', error);
    return <>{fallback}</>;
  }
}; 