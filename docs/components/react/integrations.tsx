import { IntegrationsSelectorLightDesktop } from './integrations-index-selector/integrations-selector-light-desktop';
import { IntegrationsSelectorLightMobile } from './integrations-index-selector/integrations-selector-light-mobile';
import { IntegrationLinkRoundedButton } from './integration-link-button/integration-link-rounded-button';
import { ComponentType } from 'react';
import { INTEGRATION_ORDER, IntegrationId, getIntegration } from '@/lib/integrations';
import A2AIcon from '../ui/icons/a2a';
import AdkIcon from '../ui/icons/adk';
import Ag2Icon from '../ui/icons/ag2';
import CrewaiIcon from '../ui/icons/crewai';
import DirectToLlmIcon from '../ui/icons/direct-to-llm';
import LanggraphIcon from '../ui/icons/langgraph';
import { IntegrationsSelectorDarkDesktop } from './integrations-index-selector/integrations-selector-dark-desktop';
import { IntegrationsSelectorDarkMobile } from './integrations-index-selector/integrations-selector-dark-mobile';
import LlamaIndexIcon from '../ui/icons/llama-index';
import MastraIcon from '../ui/icons/mastra';
import AgnoIcon from '../ui/icons/agno';
import PydanticAiIcon from '../ui/icons/pydantic-ai';
import { MicrosoftIcon } from '../ui/icons/microsoft';
import { AwsStrandsIcon } from '../ui/icons/aws-strands';

// Icon mapping - component-specific
const INTEGRATION_ICONS: Record<IntegrationId, ComponentType<{ className?: string }>> = {
  'a2a': A2AIcon,
  'adk': AdkIcon,
  'ag2': Ag2Icon,
  'agno': AgnoIcon,
  'crewai-flows': CrewaiIcon,
  'crewai-crews': CrewaiIcon,
  'direct-to-llm': DirectToLlmIcon,
  'langgraph': LanggraphIcon,
  'llamaindex': LlamaIndexIcon,
  'mastra': MastraIcon,
  'pydantic-ai': PydanticAiIcon,
  'microsoft-agent-framework': MicrosoftIcon,
  'aws-strands': AwsStrandsIcon,
};

interface Integration {
  id: IntegrationId;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  href: string;
}

// Build integrations list from canonical order
const INTEGRATIONS: Integration[] = INTEGRATION_ORDER.map(id => {
  const meta = getIntegration(id);
  return {
    id,
    label: meta.label,
    Icon: INTEGRATION_ICONS[id],
    href: meta.href,
  };
});

interface IntegrationsGridProps {
  targetPage?: string;
  suppressDirectToLLM?: boolean;
}

const IntegrationsGrid: React.FC<IntegrationsGridProps> = ({ targetPage, suppressDirectToLLM = false }) => {
  const hasTargetPage = (integration: Integration, targetPage: string): boolean => {
    // Direct to LLM special cases
    if (integration.id === 'direct-to-llm') {
      return targetPage === 'generative-ui' || targetPage === 'frontend-actions';
    }

    // AutoGen2 missing pages
    if (integration.id === 'ag2') {
      return targetPage !== 'generative-ui' && targetPage !== 'shared-state';
    }

    // Frameworks that don't have shared-state pages
    if (targetPage === 'shared-state') {
      return !['llamaindex', 'mastra', 'ag2', 'agno'].includes(integration.id);
    }

    // All other frameworks have the standard pages
    return true;
  };

  const getHref = (integration: Integration) => {
    if (!targetPage) {
      return integration.href;
    }

    // Special cases where certain frameworks have pages in different locations
    if (integration.id === 'direct-to-llm') {
      if (targetPage === 'generative-ui') {
        return '/direct-to-llm/guides/generative-ui';
      }
      if (targetPage === 'frontend-actions') {
        return '/direct-to-llm/guides/frontend-actions';
      }
    }

    // For other frameworks, append the target page
    return `${integration.href}/${targetPage}`;
  };

  let filteredIntegrations = INTEGRATIONS;

  // Filter out Direct to LLM if suppressed
  if (suppressDirectToLLM) {
    filteredIntegrations = filteredIntegrations.filter(integration => integration.id !== 'direct-to-llm');
  }

  // Filter out integrations that don't have the target page
  if (targetPage) {
    filteredIntegrations = filteredIntegrations.filter(integration => hasTargetPage(integration, targetPage));
  }

  return (
    <div className='flex flex-row flex-wrap justify-center items-center gap-x-6 gap-y-6 my-8'>
      <div className='hidden lg:flex'>
        <IntegrationsSelectorLightDesktop className='h-48 block dark:hidden' />
        <IntegrationsSelectorDarkDesktop className='h-48 hidden dark:block' />
        <div className='grid grid-cols-4 gap-2'>
          {filteredIntegrations.map((integration) => (
            <IntegrationLinkRoundedButton
              key={integration.id}
              label={integration.label}
              Icon={integration.Icon}
              href={getHref(integration)}
            />
          ))}
        </div>
      </div>
      <div className='flex flex-row gap-2 lg:hidden'>
        <IntegrationsSelectorLightMobile className='h-full -ml-11 block dark:hidden' />
        <IntegrationsSelectorDarkMobile className='h-full -ml-11 hidden dark:block' />
        <div className='grid grid-cols-2 gap-2 -ml-5'>
          <div className='col-span-2 h-[80px]' />
          {filteredIntegrations.map((integration) => (
            <IntegrationLinkRoundedButton
              key={integration.id}
              label={integration.label}
              Icon={integration.Icon}
              href={getHref(integration)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export { IntegrationsGrid };
export type { IntegrationsGridProps };
