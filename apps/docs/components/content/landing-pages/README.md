# Framework Overview Component

The `FrameworkOverview` component is a reusable landing page component that allows you to create consistent framework-specific landing pages with customizable content.

## Usage

```tsx
import { FrameworkOverview } from "./framework-overview";

export function MyFrameworkOverview() {
  return (
    <FrameworkOverview
      frameworkName="MyFramework"
      frameworkIcon={<MyIcon className="h-16 w-16" />}
      header="Your main headline"
      subheader="Your subheader description"
      bannerVideo="https://example.com/video.mp4"
      guideLink="/guides/myframework"
      initCommand="npx myframework@latest init"
      featuresLink="https://features.example.com"
      supportedFeatures={[...]}
      architectureImage="https://example.com/architecture.png"
      liveDemos={[...]}
      tutorialLink="/tutorials/myframework" // Optional
    />
  );
}
```

## Props

### Required Props

- **`frameworkName`** (string): The name of the framework (e.g., "LangGraph", "CrewAI")
- **`frameworkIcon`** (ReactNode): The icon component for the framework
- **`header`** (string): The main headline text
- **`subheader`** (string): The descriptive text below the header
- **`bannerVideo`** (string): URL to the overview video
- **`guideLink`** (string): Link to the framework's guide/quickstart
- **`initCommand`** (string): The initialization command to copy
- **`featuresLink`** (string): Link to view framework features
- **`architectureImage`** (string): URL to the architecture diagram
- **`liveDemos`** (LiveDemo[]): Array of live demo configurations

### Optional Props

- **`supportedFeatures`** (FrameworkFeature[]): Array of features to display (if empty, features section is hidden)
- **`tutorialLink`** (string): Link to tutorial (if empty, tutorial card is hidden)

## Data Types

### FrameworkFeature

```tsx
interface FrameworkFeature {
  title: string;
  description: string;
  documentationLink: string;
  demoLink: string;
  videoUrl: string;
}
```

### LiveDemo

```tsx
interface LiveDemo {
  type: 'saas' | 'canvas';
  title: string;
  description: string;
  iframeUrl: string;
}
```

## Features

- **Conditional Rendering**: Features section only shows if `supportedFeatures` array has items
- **Dynamic Demo Tabs**: Demo toggle buttons only appear if multiple demos are provided
- **Flexible Layout**: Next steps section automatically adjusts grid layout based on whether tutorial link is provided
- **Copy to Clipboard**: Init command button includes copy functionality with visual feedback
- **Responsive Design**: Built with responsive design principles
- **Consistent Styling**: Maintains consistent visual hierarchy and spacing

## Examples

See the following files for complete examples:
- `langgraph.tsx` - LangGraph framework implementation
- `crewai-example.tsx` - CrewAI framework implementation example

## Customization

The component uses Tailwind CSS classes and follows the existing design system. You can customize:

- Colors by modifying the CSS variables
- Spacing by adjusting the margin/padding classes
- Layout by modifying the grid classes
- Typography by changing the text size and weight classes
