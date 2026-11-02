import { tanstackAIAgent } from '@copilotkit/runtime/tanstack-ai'
import { anthropicText } from '@tanstack/ai-anthropic'

export const agent = tanstackAIAgent({ adapter: () => anthropicText('claude-sonnet-4.5'), prompt: 'Be brief.' })
