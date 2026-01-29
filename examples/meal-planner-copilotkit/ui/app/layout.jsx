import './globals.css'
import '@copilotkit/react-ui/styles.css'

export const metadata = {
  title: 'Meal Planner - CopilotKit + LlamaIndex',
  description: 'AI-powered meal planning with CopilotKit and LlamaIndex',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
