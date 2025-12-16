import { IntegrationsSelectorLightDesktop } from './integrations-index-selector/integrations-selector-light-desktop';
import { IntegrationsSelectorLightMobile } from './integrations-index-selector/integrations-selector-light-mobile';
import { IntegrationLinkRoundedButton } from './integration-link-button/integration-link-rounded-button';
import { ComponentType } from 'react';
import AdkIcon from '../ui/icons/adk';
import Ag2Icon from '../ui/icons/ag2';
import CrewaiIcon from '../ui/icons/crewai';
import DirectToLlmIcon from '../ui/icons/direct-to-llm';
import LanggraphIcon from '../ui/icons/langgraph';
import PydanticAiIcon from '../ui/icons/pydantic-ai';
import { IntegrationsSelectorDarkDesktop } from './integrations-index-selector/integrations-selector-dark-desktop';
import { IntegrationsSelectorDarkMobile } from './integrations-index-selector/integrations-selector-dark-mobile';
import LlamaIndexIcon from '../ui/icons/llama-index';
import MastraIcon from '../ui/icons/mastra';
import AgnoIcon from '../ui/icons/agno';
import { MicrosoftIcon } from '../ui/icons/microsoft';
import { AwsStrandsIcon } from '../ui/icons/aws-strands';

interface Integration {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  href: string;
}

const INTEGRATIONS: Integration[] = [
  {
    label: 'Direct to LLM',
    Icon: DirectToLlmIcon,
    href: '/direct-to-llm',
  },
  {
    label: 'AG2',
    Icon: Ag2Icon,
    href: '/ag2',
  },
  {
    label: 'Agno',
    Icon: AgnoIcon,
    href: '/agno',
  },
  {
    label: 'CrewAI Flows',
    Icon: CrewaiIcon,
    href: '/crewai-flows',
  },
  {
    label: 'CrewAI Crews',
    Icon: CrewaiIcon,
    href: '/crewai-crews',
  },
  {
    label: 'LangGraph',
    Icon: LanggraphIcon,
    href: '/langgraph',
  },
  {
    label: 'LlamaIndex',
    Icon: LlamaIndexIcon,
    href: '/llamaindex',
  },
  {
    label: 'Mastra',
    Icon: MastraIcon,
    href: '/mastra',
  },
  {
    label: 'Pydantic AI',
    Icon: PydanticAiIcon,
    href: '/pydantic-ai',
  },
  {
    label: 'ADK',
    Icon: AdkIcon,
    href: '/adk',
  },
  {
    label: 'Microsoft Agent Framework',
    Icon: MicrosoftIcon,
    href: '/microsoft-agent-framework',
  },
  {
    label: 'AWS Strands',
    Icon: AwsStrandsIcon,
    href: '/aws-strands',
  },
];

interface IntegrationsGridProps {
  targetPage?: string;
  suppressDirectToLLM?: boolean;
}

const IntegrationsGrid: React.FC<IntegrationsGridProps> = ({ targetPage, suppressDirectToLLM = false }) => {
  const hasTargetPage = (integration: Integration, targetPage: string): boolean => {
    // Direct to LLM special cases
    if (integration.label === 'Direct to LLM') {
      return targetPage === 'generative-ui' || targetPage === 'frontend-actions';
    }

    // AutoGen2 missing pages
    if (integration.label === 'AutoGen2') {
      return targetPage !== 'generative-ui' && targetPage !== 'shared-state';
    }

    // Frameworks that don't have shared-state pages
    if (targetPage === 'shared-state') {
      return !['LlamaIndex', 'Mastra', 'AutoGen2', 'Agno'].includes(integration.label);
    }

    // All other frameworks have the standard pages
    return true;
  };

  const getHref = (integration: Integration) => {
    if (!targetPage) {
      return integration.href;
    }

    // Special cases where certain frameworks have pages in different locations
    if (integration.label === 'Direct to LLM') {
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
    filteredIntegrations = filteredIntegrations.filter(integration => integration.label !== 'Direct to LLM');
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
          {filteredIntegrations.map((integration, index) => (
            <IntegrationLinkRoundedButton
              key={index}
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
          {filteredIntegrations.map((integration, index) => (
            <IntegrationLinkRoundedButton
              key={index}
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
